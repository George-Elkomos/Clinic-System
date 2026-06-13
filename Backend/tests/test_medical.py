"""Phase 2 verification: record versioning, specialty-note rule, treating-doctor
scoping, scan upload/download, prescription PDF."""
import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse

from apps.core.enums import RoleChoices
from apps.doctors.models import DoctorPatient, DoctorProfile, Specialty, SpecialtyCategory
from apps.medical_records.models import MedicalRecord, Prescription, PrescriptionItem
from apps.medical_records.services.records import create_record_version

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
    assert api.get(reverse("prescription-list")).status_code == 403


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
