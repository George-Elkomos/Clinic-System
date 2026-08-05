"""Phase 15 verification: radiology templates, order lifecycle (ORDERED ->
COMPLETED -> REPORTED / CANCELLED), scan attachment on completion, role
scoping, notifications, and audit-log coverage."""
import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse

from apps.audit.models import AuditLog
from apps.core.enums import NotificationVerb, RoleChoices
from apps.doctors.models import DoctorPatient, DoctorProfile
from apps.medical_records.models import Scan
from apps.notifications.models import Notification
from apps.radiology.models import RadiologyOrder, RadiologyTemplate
from apps.radiology.services import seed_radiology_templates

pytestmark = pytest.mark.django_db


@pytest.fixture
def treated(doctor_profile, patient):
    DoctorPatient.objects.create(doctor=doctor_profile, patient=patient.patient_profile)
    return patient


@pytest.fixture
def manager(make_user):
    return make_user("mgr-rad@test.dev", RoleChoices.MANAGER, first_name="Man", last_name="Ager")


@pytest.fixture
def template():
    return RadiologyTemplate.objects.create(
        name="Chest X-Ray", modality="XRAY", body_part="Chest",
        instructions="Remove jewelry from the chest and neck area.",
    )


def _scan_file(name="scan.png"):
    return SimpleUploadedFile(name, b"\x89PNG\r\n\x1a\n fake", content_type="image/png")


# --- Template management ------------------------------------------------------
def test_doctor_can_create_template(api, doctor_profile):
    api.force_authenticate(doctor_profile.user)
    resp = api.post(reverse("radiology-template-list"), {
        "name": "Abdominal Ultrasound", "modality": "ULTRASOUND", "body_part": "Abdomen",
    }, format="json")
    assert resp.status_code == 201


def test_patient_cannot_write_template(api, patient, template):
    api.force_authenticate(patient)
    assert api.get(reverse("radiology-template-list")).status_code == 200
    resp = api.patch(reverse("radiology-template-detail", args=[template.id]), {"name": "x"}, format="json")
    assert resp.status_code == 403


def test_secretary_cannot_write_templates_but_can_read(api, secretary, template):
    api.force_authenticate(secretary)
    assert api.get(reverse("radiology-template-list")).status_code == 200
    resp = api.patch(reverse("radiology-template-detail", args=[template.id]), {"name": "x"}, format="json")
    assert resp.status_code == 403


# --- Creation --------------------------------------------------------------------
def test_create_from_template_denormalizes_study_name(api, doctor_profile, treated, template):
    api.force_authenticate(doctor_profile.user)
    resp = api.post(reverse("radiology-order-list"), {
        "patient": treated.patient_profile.id, "template": template.id,
    }, format="json")
    assert resp.status_code == 201
    assert resp.data["study_name"] == "Chest X-Ray"
    assert resp.data["status"] == "ORDERED"
    assert resp.data["accession_number"].startswith("RAD-")


def test_create_custom_order(api, doctor_profile, treated):
    api.force_authenticate(doctor_profile.user)
    resp = api.post(reverse("radiology-order-list"), {
        "patient": treated.patient_profile.id, "study_name": "Wrist X-Ray",
        "clinical_reason": "Suspected fracture",
    }, format="json")
    assert resp.status_code == 201
    assert resp.data["study_name"] == "Wrist X-Ray"


def test_create_requires_template_or_study_name(api, doctor_profile, treated):
    api.force_authenticate(doctor_profile.user)
    resp = api.post(reverse("radiology-order-list"), {"patient": treated.patient_profile.id}, format="json")
    assert resp.status_code == 400


def test_doctor_cannot_create_for_untreated_patient(api, doctor_profile, patient):
    api.force_authenticate(doctor_profile.user)
    resp = api.post(reverse("radiology-order-list"), {
        "patient": patient.patient_profile.id, "study_name": "Wrist X-Ray",
    }, format="json")
    assert resp.status_code == 403


def test_patient_cannot_create_order(api, treated, doctor_profile):
    api.force_authenticate(treated)
    resp = api.post(reverse("radiology-order-list"), {
        "patient": treated.patient_profile.id, "study_name": "Self-requested",
    }, format="json")
    assert resp.status_code == 403


# --- Lifecycle -----------------------------------------------------------------
def test_full_lifecycle_complete_then_report(api, doctor_profile, treated, template):
    api.force_authenticate(doctor_profile.user)
    created = api.post(reverse("radiology-order-list"), {
        "patient": treated.patient_profile.id, "template": template.id,
    }, format="json").data
    order_id = created["id"]

    # Cannot report before completing.
    blocked = api.post(reverse("radiology-order-report", args=[order_id]), {
        "findings": "x", "impression": "y",
    }, format="json")
    assert blocked.status_code == 400

    completed = api.post(reverse("radiology-order-complete", args=[order_id]), {
        "file": _scan_file(), "description": "Chest X-ray image.",
    }, format="multipart")
    assert completed.status_code == 200
    assert completed.data["status"] == "COMPLETED"

    scan = Scan.objects.get(radiology_order_id=order_id)
    assert scan.patient_id == treated.patient_profile.id
    assert scan.category == "XRAY"

    # Cannot complete twice.
    twice = api.post(reverse("radiology-order-complete", args=[order_id]), {
        "file": _scan_file(),
    }, format="multipart")
    assert twice.status_code == 400

    reported = api.post(reverse("radiology-order-report", args=[order_id]), {
        "findings": "No acute abnormality.", "impression": "Unremarkable study.",
    }, format="json")
    assert reported.status_code == 200
    assert reported.data["status"] == "REPORTED"
    assert reported.data["findings"] == "No acute abnormality."

    # Reported order can no longer be cancelled.
    still_locked = api.post(reverse("radiology-order-cancel", args=[order_id]), {"reason": "too late"}, format="json")
    assert still_locked.status_code == 400


def test_cancel_from_ordered_and_completed(api, doctor_profile, treated, template):
    api.force_authenticate(doctor_profile.user)

    ordered = api.post(reverse("radiology-order-list"), {
        "patient": treated.patient_profile.id, "template": template.id,
    }, format="json").data
    cancelled = api.post(reverse("radiology-order-cancel", args=[ordered["id"]]), {"reason": "Patient no-show"}, format="json")
    assert cancelled.status_code == 200
    assert cancelled.data["status"] == "CANCELLED"

    completed_order = api.post(reverse("radiology-order-list"), {
        "patient": treated.patient_profile.id, "template": template.id,
    }, format="json").data
    api.post(reverse("radiology-order-complete", args=[completed_order["id"]]), {"file": _scan_file()}, format="multipart")
    cancelled2 = api.post(reverse("radiology-order-cancel", args=[completed_order["id"]]), {"reason": "Wrong study ordered"}, format="json")
    assert cancelled2.status_code == 200
    assert cancelled2.data["status"] == "CANCELLED"


# --- Complete-action role checks ----------------------------------------------
def test_secretary_can_complete_order(api, doctor_profile, treated, secretary, template):
    api.force_authenticate(doctor_profile.user)
    created = api.post(reverse("radiology-order-list"), {
        "patient": treated.patient_profile.id, "template": template.id,
    }, format="json").data

    api.force_authenticate(secretary)
    resp = api.post(reverse("radiology-order-complete", args=[created["id"]]), {"file": _scan_file()}, format="multipart")
    assert resp.status_code == 200
    assert resp.data["status"] == "COMPLETED"


def test_patient_cannot_complete_order(api, doctor_profile, treated, template):
    api.force_authenticate(doctor_profile.user)
    created = api.post(reverse("radiology-order-list"), {
        "patient": treated.patient_profile.id, "template": template.id,
    }, format="json").data

    api.force_authenticate(treated)
    resp = api.post(reverse("radiology-order-complete", args=[created["id"]]), {"file": _scan_file()}, format="multipart")
    assert resp.status_code == 403


def test_unrelated_doctor_cannot_complete_order(api, doctor_profile, treated, make_user, template):
    api.force_authenticate(doctor_profile.user)
    created = api.post(reverse("radiology-order-list"), {
        "patient": treated.patient_profile.id, "template": template.id,
    }, format="json").data

    other = make_user("doc-rad-complete@test.dev", RoleChoices.DOCTOR)
    DoctorProfile.objects.create(user=other, license_number="LIC-RAD-1")
    api.force_authenticate(other)
    # Queryset scoping hides it entirely (unrelated doctor doesn't treat the patient).
    resp = api.post(reverse("radiology-order-complete", args=[created["id"]]), {"file": _scan_file()}, format="multipart")
    assert resp.status_code == 404


# --- Report-action role checks -------------------------------------------------
def test_secretary_cannot_report_order(api, doctor_profile, treated, secretary, template):
    api.force_authenticate(doctor_profile.user)
    created = api.post(reverse("radiology-order-list"), {
        "patient": treated.patient_profile.id, "template": template.id,
    }, format="json").data
    api.post(reverse("radiology-order-complete", args=[created["id"]]), {"file": _scan_file()}, format="multipart")

    api.force_authenticate(secretary)
    resp = api.post(reverse("radiology-order-report", args=[created["id"]]), {
        "findings": "x", "impression": "y",
    }, format="json")
    assert resp.status_code == 403


def test_manager_can_report_order(api, doctor_profile, treated, manager, template):
    api.force_authenticate(doctor_profile.user)
    created = api.post(reverse("radiology-order-list"), {
        "patient": treated.patient_profile.id, "template": template.id,
    }, format="json").data
    api.post(reverse("radiology-order-complete", args=[created["id"]]), {"file": _scan_file()}, format="multipart")

    api.force_authenticate(manager)
    resp = api.post(reverse("radiology-order-report", args=[created["id"]]), {
        "findings": "Manager reviewed.", "impression": "Normal.",
    }, format="json")
    assert resp.status_code == 200
    assert resp.data["status"] == "REPORTED"


# --- Role scoping ----------------------------------------------------------------
def test_role_scoping(api, doctor_profile, treated, patient2, secretary, manager, make_user, template):
    api.force_authenticate(doctor_profile.user)
    api.post(reverse("radiology-order-list"), {
        "patient": treated.patient_profile.id, "template": template.id,
    }, format="json")

    # Treating doctor sees it.
    assert api.get(reverse("radiology-order-list")).data["count"] == 1

    # An unrelated doctor sees nothing.
    other = make_user("doc-rad-scope@test.dev", RoleChoices.DOCTOR)
    DoctorProfile.objects.create(user=other, license_number="LIC-RAD-2")
    api.force_authenticate(other)
    assert api.get(reverse("radiology-order-list")).data["count"] == 0

    # The owning patient sees their own record.
    api.force_authenticate(treated)
    assert api.get(reverse("radiology-order-list")).data["count"] == 1

    # An unrelated patient sees nothing.
    api.force_authenticate(patient2)
    assert api.get(reverse("radiology-order-list")).data["count"] == 0

    # Secretary sees all (radiology logistics staff).
    api.force_authenticate(secretary)
    assert api.get(reverse("radiology-order-list")).data["count"] == 1

    # Manager sees all.
    api.force_authenticate(manager)
    assert api.get(reverse("radiology-order-list")).data["count"] == 1


def test_untreated_doctor_gets_404_on_detail(api, doctor_profile, treated, make_user, template):
    api.force_authenticate(doctor_profile.user)
    created = api.post(reverse("radiology-order-list"), {
        "patient": treated.patient_profile.id, "template": template.id,
    }, format="json").data

    other = make_user("doc-rad-404@test.dev", RoleChoices.DOCTOR)
    DoctorProfile.objects.create(user=other, license_number="LIC-RAD-404")
    api.force_authenticate(other)
    assert api.get(reverse("radiology-order-detail", args=[created["id"]])).status_code == 404


# --- Destroy ---------------------------------------------------------------------
def test_ordering_doctor_can_delete_only_while_ordered(api, doctor_profile, treated, template):
    api.force_authenticate(doctor_profile.user)
    created = api.post(reverse("radiology-order-list"), {
        "patient": treated.patient_profile.id, "template": template.id,
    }, format="json").data
    order_id = created["id"]
    api.post(reverse("radiology-order-complete", args=[order_id]), {"file": _scan_file()}, format="multipart")

    # Once COMPLETED, delete is no longer permitted.
    resp = api.delete(reverse("radiology-order-detail", args=[order_id]))
    assert resp.status_code == 403

    fresh = api.post(reverse("radiology-order-list"), {
        "patient": treated.patient_profile.id, "template": template.id,
    }, format="json").data
    resp2 = api.delete(reverse("radiology-order-detail", args=[fresh["id"]]))
    assert resp2.status_code == 204


# --- Notifications ----------------------------------------------------------------
def test_notification_sent_on_order_complete_report_cancel(api, doctor_profile, treated, template):
    api.force_authenticate(doctor_profile.user)
    created = api.post(reverse("radiology-order-list"), {
        "patient": treated.patient_profile.id, "template": template.id,
    }, format="json").data
    assert Notification.objects.filter(recipient=treated, verb=NotificationVerb.RADIOLOGY_ORDER_CREATED).exists()

    api.post(reverse("radiology-order-complete", args=[created["id"]]), {"file": _scan_file()}, format="multipart")
    assert Notification.objects.filter(recipient=treated, verb=NotificationVerb.RADIOLOGY_ORDER_COMPLETED).exists()

    api.post(reverse("radiology-order-report", args=[created["id"]]), {
        "findings": "x", "impression": "y",
    }, format="json")
    assert Notification.objects.filter(recipient=treated, verb=NotificationVerb.RADIOLOGY_ORDER_REPORTED).exists()

    other_order = api.post(reverse("radiology-order-list"), {
        "patient": treated.patient_profile.id, "template": template.id,
    }, format="json").data
    api.post(reverse("radiology-order-cancel", args=[other_order["id"]]), {"reason": "no longer needed"}, format="json")
    assert Notification.objects.filter(recipient=treated, verb=NotificationVerb.RADIOLOGY_ORDER_CANCELLED).exists()


# --- Seed data ---------------------------------------------------------------------
def test_seed_templates_are_bilingual():
    counts = seed_radiology_templates()
    assert counts["created"] >= 1 or counts["updated"] >= 1
    templates = RadiologyTemplate.objects.filter(is_active=True).exclude(name="Other Imaging Study")
    assert templates.exists()
    for tpl in templates:
        assert tpl.name_ar.strip(), f"Template '{tpl.name}' is missing an Arabic name"


# --- Audit coverage ----------------------------------------------------------------
def test_audit_log_records_radiology_order_lifecycle(api, doctor_profile, treated, template):
    api.force_authenticate(doctor_profile.user)
    created = api.post(reverse("radiology-order-list"), {
        "patient": treated.patient_profile.id, "template": template.id,
    }, format="json").data
    order_id = created["id"]

    create_log = AuditLog.objects.filter(
        model_name="RadiologyOrder", object_id=str(order_id), action="CREATE"
    ).first()
    assert create_log is not None
    assert create_log.actor_id == doctor_profile.user_id

    api.post(reverse("radiology-order-complete", args=[order_id]), {"file": _scan_file()}, format="multipart")
    api.post(reverse("radiology-order-report", args=[order_id]), {
        "findings": "x", "impression": "y",
    }, format="json")

    update_logs = AuditLog.objects.filter(model_name="RadiologyOrder", object_id=str(order_id), action="UPDATE")
    assert update_logs.count() >= 2  # complete + report transitions


# --- Scan linkage --------------------------------------------------------------
def test_completed_scan_downloadable_through_scan_viewset(api, doctor_profile, treated, template):
    api.force_authenticate(doctor_profile.user)
    created = api.post(reverse("radiology-order-list"), {
        "patient": treated.patient_profile.id, "template": template.id,
    }, format="json").data
    api.post(reverse("radiology-order-complete", args=[created["id"]]), {"file": _scan_file()}, format="multipart")

    scan = Scan.objects.get(radiology_order_id=created["id"])
    resp = api.get(reverse("scan-download", args=[scan.id]))
    assert resp.status_code == 200
