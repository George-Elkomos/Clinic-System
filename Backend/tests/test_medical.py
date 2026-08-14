"""Phase 2 verification: record versioning, specialty-note rule, treating-doctor
scoping, scan upload/download, prescription PDF."""
from datetime import timedelta

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from django.utils import timezone

from apps.appointments.models import Appointment
from apps.audit.models import AuditLog
from apps.core.enums import AppointmentStatus, NotificationVerb, RoleChoices
from apps.doctors.models import DoctorPatient, DoctorProfile, Specialty, SpecialtyCategory
from apps.medical_records.models import MedicalRecord, Prescription, PrescriptionItem
from apps.medical_records.services.records import create_record_version
from apps.notifications.models import Notification

pytestmark = pytest.mark.django_db


@pytest.fixture
def treated(doctor_profile, patient):
    """Link doctor_profile as a treating doctor of `patient`."""
    DoctorPatient.objects.create(doctor=doctor_profile, patient=patient.patient_profile)
    return patient


# --- Record versioning ------------------------------------------------------
def test_record_versioning(doctor_profile, patient):
    r1 = create_record_version(patient=patient.patient_profile, doctor=doctor_profile,
                               data={"diagnosis": "v1"})
    r2 = create_record_version(patient=patient.patient_profile, doctor=doctor_profile,
                               data={"diagnosis": "v2"})
    r1.refresh_from_db()
    assert r1.version == 1 and r2.version == 2
    assert r2.is_current is True and r1.is_current is False
    assert r2.supersedes_id == r1.id


def test_doctor_creates_record_via_api(api, doctor_profile, treated):
    api.force_authenticate(doctor_profile.user)
    resp = api.post(reverse("medical-record-list"),
                    {"patient": treated.patient_profile.id, "diagnosis": "Checked"}, format="json")
    assert resp.status_code == 201
    assert resp.data["version"] == 1 and resp.data["is_current"] is True


def test_manager_cannot_author_medical_record(api, make_user, treated):
    """Regression: clinical content is doctor-exclusive to author — a manager
    is administrative, not a treating clinician, and must not be able to
    write into a patient's medical record (matches Encounters/Clinical Notes)."""
    manager = make_user("mgr-mr@test.dev", RoleChoices.MANAGER)
    api.force_authenticate(manager)
    resp = api.post(reverse("medical-record-list"),
                    {"patient": treated.patient_profile.id, "diagnosis": "Should not save"}, format="json")
    assert resp.status_code == 403
    assert MedicalRecord.objects.filter(diagnosis="Should not save").count() == 0


# --- Specialty-tagged clinical note rule ------------------------------------
def test_note_specialty_rule(api, doctor_profile, treated):
    # doctor_profile's specialty is in the "General" category (see conftest).
    own_category = SpecialtyCategory.objects.get(name="General")
    other_category = SpecialtyCategory.objects.create(name="Cardiovascular")

    api.force_authenticate(doctor_profile.user)
    base = {"patient": treated.patient_profile.id, "body": "note"}

    ok = api.post(reverse("clinical-note-list"),
                  {**base, "specialty_category": own_category.id}, format="json")
    assert ok.status_code == 201

    blocked = api.post(reverse("clinical-note-list"),
                       {**base, "specialty_category": other_category.id}, format="json")
    assert blocked.status_code == 400  # serializer.validate rejects cross-specialty


# --- Treating-doctor scoping ------------------------------------------------
def test_record_scoping(api, doctor_profile, treated, make_user):
    create_record_version(patient=treated.patient_profile, doctor=doctor_profile, data={"diagnosis": "x"})

    # Treating doctor sees it.
    api.force_authenticate(doctor_profile.user)
    assert api.get(reverse("medical-record-list")).data["count"] == 1

    # An untreated doctor sees nothing.
    other = make_user("doc9@test.dev", RoleChoices.DOCTOR)
    DoctorProfile.objects.create(user=other, license_number="LIC-T9")
    api.force_authenticate(other)
    assert api.get(reverse("medical-record-list")).data["count"] == 0

    # The patient sees their own record.
    api.force_authenticate(treated)
    assert api.get(reverse("medical-record-list")).data["count"] == 1


def test_secretary_forbidden_from_medical(api, secretary):
    api.force_authenticate(secretary)
    assert api.get(reverse("medical-record-list")).status_code == 403
    # Prescriptions are the one exception: secretaries get read-only access
    # for the desk "view status / print & hand over" workflow (see
    # test_secretary_scope.py), but still can't write one.
    assert api.get(reverse("prescription-list")).status_code == 200
    assert api.post(reverse("prescription-list"), {}, format="json").status_code == 403


# --- Scan upload + secure download ------------------------------------------
def test_scan_upload_and_download(api, doctor_profile, treated, patient2):
    api.force_authenticate(treated)  # patient uploads own scan
    upload = SimpleUploadedFile("xray.png", b"\x89PNG\r\n\x1a\n fake", content_type="image/png")
    created = api.post(reverse("scan-list"),
                       {"category": "XRAY", "file": upload}, format="multipart")
    assert created.status_code == 201
    scan_id = created.data["id"]
    assert created.data["original_filename"] == "xray.png"

    # Owner can download.
    assert api.get(reverse("scan-download", args=[scan_id])).status_code == 200
    # Treating doctor can download.
    api.force_authenticate(doctor_profile.user)
    assert api.get(reverse("scan-download", args=[scan_id])).status_code == 200
    # An unrelated patient cannot even see it (queryset-scoped -> 404).
    api.force_authenticate(patient2)
    assert api.get(reverse("scan-download", args=[scan_id])).status_code == 404


def test_scan_rejects_bad_filetype(api, treated):
    api.force_authenticate(treated)
    bad = SimpleUploadedFile("notes.exe", b"MZ", content_type="application/octet-stream")
    resp = api.post(reverse("scan-list"), {"category": "OTHER", "file": bad}, format="multipart")
    assert resp.status_code == 400


def test_scan_upload_and_delete_are_audited(api, treated):
    api.force_authenticate(treated)
    upload = SimpleUploadedFile("xray.png", b"\x89PNG\r\n\x1a\n fake", content_type="image/png")
    created = api.post(reverse("scan-list"), {"category": "XRAY", "file": upload}, format="multipart")
    assert created.status_code == 201
    scan_id = created.data["id"]

    create_log = AuditLog.objects.filter(model_name="Scan", object_id=str(scan_id), action="CREATE").first()
    assert create_log is not None
    assert create_log.actor_id == treated.id

    # Scan.destroy() soft-deletes (a save, not a real row delete), so this
    # shows up as an UPDATE entry with the is_deleted/deleted_at transition —
    # not a DELETE entry — which is the correct, honest representation.
    deleted = api.delete(reverse("scan-detail", args=[scan_id]))
    assert deleted.status_code == 204

    delete_log = AuditLog.objects.filter(model_name="Scan", object_id=str(scan_id), action="UPDATE").first()
    assert delete_log is not None
    assert delete_log.actor_id == treated.id
    assert delete_log.changes.get("is_deleted") == {"old": False, "new": True}


# --- Patient self-upload notifies the nearest-in-time doctor ------------------
def _make_appointment(patient, doctor, *, status, start_offset):
    start = timezone.now() + start_offset
    return Appointment.objects.create(
        patient=patient, doctor=doctor, scheduled_start=start, scheduled_end=start + timedelta(minutes=15),
        status=status, completed_at=timezone.now() + start_offset if status == AppointmentStatus.COMPLETED else None,
    )


def test_patient_scan_upload_notifies_upcoming_doctor_over_past_doctor(api, doctor_profile, treated, make_user):
    past_doctor_user = make_user("doc-past@test.dev", RoleChoices.DOCTOR)
    past_doctor = DoctorProfile.objects.create(user=past_doctor_user, license_number="LIC-PAST")
    _make_appointment(treated.patient_profile, past_doctor, status=AppointmentStatus.COMPLETED, start_offset=-timedelta(days=10))
    _make_appointment(treated.patient_profile, doctor_profile, status=AppointmentStatus.CONFIRMED, start_offset=timedelta(days=2))

    api.force_authenticate(treated)
    upload = SimpleUploadedFile("xray.png", b"\x89PNG\r\n\x1a\n fake", content_type="image/png")
    resp = api.post(reverse("scan-list"), {"category": "XRAY", "file": upload}, format="multipart")
    assert resp.status_code == 201

    assert Notification.objects.filter(recipient=doctor_profile.user, verb=NotificationVerb.PATIENT_SCAN_UPLOADED).exists()
    assert not Notification.objects.filter(recipient=past_doctor_user, verb=NotificationVerb.PATIENT_SCAN_UPLOADED).exists()


def test_patient_scan_upload_falls_back_to_most_recent_completed_doctor(api, doctor_profile, treated):
    _make_appointment(treated.patient_profile, doctor_profile, status=AppointmentStatus.COMPLETED, start_offset=-timedelta(days=5))

    api.force_authenticate(treated)
    upload = SimpleUploadedFile("xray2.png", b"\x89PNG\r\n\x1a\n fake", content_type="image/png")
    resp = api.post(reverse("scan-list"), {"category": "XRAY", "file": upload}, format="multipart")
    assert resp.status_code == 201
    assert Notification.objects.filter(recipient=doctor_profile.user, verb=NotificationVerb.PATIENT_SCAN_UPLOADED).exists()


def test_patient_scan_upload_with_no_appointments_notifies_nobody(api, make_user):
    lone_patient = make_user("lone-patient@test.dev", RoleChoices.PATIENT)
    api.force_authenticate(lone_patient)
    upload = SimpleUploadedFile("xray3.png", b"\x89PNG\r\n\x1a\n fake", content_type="image/png")
    resp = api.post(reverse("scan-list"), {"category": "XRAY", "file": upload}, format="multipart")
    assert resp.status_code == 201
    assert not Notification.objects.filter(verb=NotificationVerb.PATIENT_SCAN_UPLOADED).exists()


def test_doctor_uploaded_scan_does_not_trigger_patient_upload_notification(api, doctor_profile, treated):
    api.force_authenticate(doctor_profile.user)
    upload = SimpleUploadedFile("xray4.png", b"\x89PNG\r\n\x1a\n fake", content_type="image/png")
    resp = api.post(reverse("scan-list"), {
        "patient": treated.patient_profile.id, "category": "XRAY", "file": upload,
    }, format="multipart")
    assert resp.status_code == 201
    assert not Notification.objects.filter(verb=NotificationVerb.PATIENT_SCAN_UPLOADED).exists()


# --- Prescription + PDF -----------------------------------------------------
def test_prescription_create_and_pdf(api, doctor_profile, treated):
    api.force_authenticate(doctor_profile.user)
    payload = {
        "patient": treated.patient_profile.id,
        "notes": "Take with food",
        "items": [
            {"drug_name": "Amoxicillin", "dosage": "500mg", "frequency": "3x daily", "duration": "7 days"},
        ],
    }
    created = api.post(reverse("prescription-list"), payload, format="json")
    assert created.status_code == 201
    assert len(created.data["items"]) == 1
    pid = created.data["id"]
    assert PrescriptionItem.objects.filter(prescription_id=pid).count() == 1

    pdf = api.get(reverse("prescription-pdf", args=[pid]))
    assert pdf.status_code == 200
    assert pdf["Content-Type"] == "application/pdf"
    body = b"".join(pdf.streaming_content)
    assert body.startswith(b"%PDF") and len(body) > 500
