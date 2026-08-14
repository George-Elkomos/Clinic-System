"""Phase 14 verification: procedure templates, lifecycle transitions, checklist
state, required post-notes on completion, role scoping, notifications, and
audit-log coverage."""
import pytest
from django.urls import reverse

from apps.audit.models import AuditLog
from apps.core.enums import NotificationVerb, RoleChoices
from apps.doctors.models import DoctorPatient, DoctorProfile
from apps.notifications.models import Notification
from apps.procedures.models import ClinicalProcedure, ProcedureTemplate
from apps.procedures.services import seed_procedure_templates

pytestmark = pytest.mark.django_db


@pytest.fixture
def treated(doctor_profile, patient):
    DoctorPatient.objects.create(doctor=doctor_profile, patient=patient.patient_profile)
    return patient


@pytest.fixture
def manager(make_user):
    return make_user("mgr@test.dev", RoleChoices.MANAGER, first_name="Man", last_name="Ager")


@pytest.fixture
def template():
    return ProcedureTemplate.objects.create(
        name="Wound Suturing",
        category="MINOR_SURGERY",
        estimated_duration_minutes=30,
        checklist_template=[
            {"step": "Sterilize area", "required": True},
            {"step": "Apply local anesthesia", "required": True},
            {"step": "Execute suture", "required": True},
        ],
    )


# --- Template management ------------------------------------------------------
def test_doctor_can_create_template(api, doctor_profile):
    api.force_authenticate(doctor_profile.user)
    resp = api.post(reverse("procedure-template-list"), {
        "name": "Dressing Change", "category": "DRESSING",
        "checklist_template": [{"step": "Remove old dressing", "required": True}],
    }, format="json")
    assert resp.status_code == 201


def test_patient_cannot_write_template(api, patient, template):
    api.force_authenticate(patient)
    assert api.get(reverse("procedure-template-list")).status_code == 200
    resp = api.patch(reverse("procedure-template-detail", args=[template.id]), {"name": "x"}, format="json")
    assert resp.status_code == 403


# --- Creation from template ----------------------------------------------------
def test_create_from_template_copies_checklist(api, doctor_profile, treated, template):
    api.force_authenticate(doctor_profile.user)
    resp = api.post(reverse("procedure-list"), {
        "patient": treated.patient_profile.id, "template": template.id,
    }, format="json")
    assert resp.status_code == 201
    assert resp.data["procedure_name"] == "Wound Suturing"
    assert resp.data["status"] == "SCHEDULED"
    assert len(resp.data["checklist_state"]) == 3
    assert all(step["completed"] is False for step in resp.data["checklist_state"])


def test_create_custom_procedure(api, doctor_profile, treated):
    api.force_authenticate(doctor_profile.user)
    resp = api.post(reverse("procedure-list"), {
        "patient": treated.patient_profile.id, "procedure_name": "Ear Cleaning",
    }, format="json")
    assert resp.status_code == 201
    assert resp.data["procedure_name"] == "Ear Cleaning"
    assert resp.data["checklist_state"] == []


def test_doctor_cannot_create_for_untreated_patient(api, doctor_profile, patient):
    api.force_authenticate(doctor_profile.user)
    resp = api.post(reverse("procedure-list"), {
        "patient": patient.patient_profile.id, "procedure_name": "Ear Cleaning",
    }, format="json")
    assert resp.status_code == 403


# --- Lifecycle -----------------------------------------------------------------
def test_full_lifecycle(api, doctor_profile, treated, template):
    api.force_authenticate(doctor_profile.user)
    created = api.post(reverse("procedure-list"), {
        "patient": treated.patient_profile.id, "template": template.id,
    }, format="json")
    proc_id = created.data["id"]

    # Cannot complete before starting.
    assert api.post(reverse("procedure-complete", args=[proc_id])).status_code == 400

    start = api.post(reverse("procedure-start", args=[proc_id]))
    assert start.status_code == 200
    assert start.data["status"] == "IN_PROGRESS"
    assert start.data["start_time"] is not None

    # Toggle checklist steps via PATCH.
    checklist = start.data["checklist_state"]
    checklist[0]["completed"] = True
    patched = api.patch(reverse("procedure-detail", args=[proc_id]), {
        "checklist_state": checklist, "pre_procedure_notes": "Consent obtained",
    }, format="json")
    assert patched.status_code == 200
    assert patched.data["checklist_state"][0]["completed"] is True

    # Complete without post-notes is rejected.
    blocked = api.post(reverse("procedure-complete", args=[proc_id]), {}, format="json")
    assert blocked.status_code == 400

    completed = api.post(reverse("procedure-complete", args=[proc_id]), {
        "post_procedure_notes": "Sutured cleanly, no complications.",
    }, format="json")
    assert completed.status_code == 200
    assert completed.data["status"] == "COMPLETED"
    assert completed.data["end_time"] is not None

    # Terminal record is locked against further checklist/notes edits.
    locked = api.patch(reverse("procedure-detail", args=[proc_id]), {
        "post_procedure_notes": "edited after completion",
    }, format="json")
    assert locked.status_code == 400


def test_cancel_from_scheduled_and_in_progress(api, doctor_profile, treated, template):
    api.force_authenticate(doctor_profile.user)

    scheduled = api.post(reverse("procedure-list"), {
        "patient": treated.patient_profile.id, "template": template.id,
    }, format="json").data
    cancelled = api.post(reverse("procedure-cancel", args=[scheduled["id"]]), {"reason": "Patient no-show"}, format="json")
    assert cancelled.status_code == 200
    assert cancelled.data["status"] == "CANCELLED"

    in_progress = api.post(reverse("procedure-list"), {
        "patient": treated.patient_profile.id, "template": template.id,
    }, format="json").data
    api.post(reverse("procedure-start", args=[in_progress["id"]]))
    cancelled2 = api.post(reverse("procedure-cancel", args=[in_progress["id"]]), {"reason": "Complication"}, format="json")
    assert cancelled2.status_code == 200
    assert cancelled2.data["status"] == "CANCELLED"

    # A completed procedure can no longer be cancelled.
    completed = api.post(reverse("procedure-list"), {
        "patient": treated.patient_profile.id, "template": template.id,
    }, format="json").data
    api.post(reverse("procedure-start", args=[completed["id"]]))
    api.post(reverse("procedure-complete", args=[completed["id"]]), {"post_procedure_notes": "done"}, format="json")
    still_locked = api.post(reverse("procedure-cancel", args=[completed["id"]]), {"reason": "too late"}, format="json")
    assert still_locked.status_code == 400


# --- Role scoping ----------------------------------------------------------------
def test_role_scoping(api, doctor_profile, treated, patient2, secretary, make_user, template):
    api.force_authenticate(doctor_profile.user)
    api.post(reverse("procedure-list"), {
        "patient": treated.patient_profile.id, "template": template.id,
    }, format="json")

    # Treating doctor sees it.
    assert api.get(reverse("procedure-list")).data["count"] == 1

    # An unrelated doctor sees nothing.
    other = make_user("doc-proc@test.dev", RoleChoices.DOCTOR)
    DoctorProfile.objects.create(user=other, license_number="LIC-P9")
    api.force_authenticate(other)
    assert api.get(reverse("procedure-list")).data["count"] == 0

    # The owning patient sees their own record.
    api.force_authenticate(treated)
    assert api.get(reverse("procedure-list")).data["count"] == 1

    # An unrelated patient sees nothing.
    api.force_authenticate(patient2)
    assert api.get(reverse("procedure-list")).data["count"] == 0

    # Secretary has no access at all (no NURSE role in this system).
    api.force_authenticate(secretary)
    assert api.get(reverse("procedure-list")).status_code == 403


# --- Manager role (read-only oversight) ------------------------------------------
def test_manager_sees_all_but_cannot_act_on_a_procedure(api, doctor_profile, treated, manager, template):
    """Regression: a manager used to be able to start/complete/cancel — or PATCH
    any field of — any procedure, even one they never performed. Procedures
    document a real clinical act, so only the performing doctor may drive its
    lifecycle; manager keeps full-visibility read access for oversight."""
    api.force_authenticate(doctor_profile.user)
    created = api.post(reverse("procedure-list"), {
        "patient": treated.patient_profile.id, "template": template.id,
    }, format="json").data

    api.force_authenticate(manager)
    assert api.get(reverse("procedure-list")).data["count"] == 1
    assert api.get(reverse("procedure-detail", args=[created["id"]])).status_code == 200

    started = api.post(reverse("procedure-start", args=[created["id"]]))
    assert started.status_code == 403
    completed = api.post(reverse("procedure-complete", args=[created["id"]]), {
        "post_procedure_notes": "Completed by manager oversight.",
    }, format="json")
    assert completed.status_code == 403
    cancelled = api.post(reverse("procedure-cancel", args=[created["id"]]), {
        "reason": "Manager override attempt.",
    }, format="json")
    assert cancelled.status_code == 403
    patched = api.patch(reverse("procedure-detail", args=[created["id"]]), {
        "pre_procedure_notes": "Manager edit attempt.",
    }, format="json")
    assert patched.status_code == 403


def test_manager_can_manage_templates(api, manager, template):
    api.force_authenticate(manager)
    created = api.post(reverse("procedure-template-list"), {
        "name": "Manager Template", "category": "OTHER",
    }, format="json")
    assert created.status_code == 201
    updated = api.patch(reverse("procedure-template-detail", args=[template.id]), {"is_active": False}, format="json")
    assert updated.status_code == 200
    assert updated.data["is_active"] is False


# --- Permission edge cases: 403/404 ----------------------------------------------
def test_patient_cannot_write_or_transition_own_procedure(api, doctor_profile, treated, template):
    api.force_authenticate(doctor_profile.user)
    created = api.post(reverse("procedure-list"), {
        "patient": treated.patient_profile.id, "template": template.id,
    }, format="json").data

    api.force_authenticate(treated)
    assert api.post(reverse("procedure-list"), {
        "patient": treated.patient_profile.id, "procedure_name": "Self-requested",
    }, format="json").status_code == 403
    assert api.patch(reverse("procedure-detail", args=[created["id"]]), {
        "pre_procedure_notes": "patient trying to edit",
    }, format="json").status_code == 403
    assert api.post(reverse("procedure-start", args=[created["id"]])).status_code == 403
    assert api.post(reverse("procedure-complete", args=[created["id"]]), {
        "post_procedure_notes": "x",
    }, format="json").status_code == 403
    assert api.post(reverse("procedure-cancel", args=[created["id"]]), {
        "reason": "patient trying to cancel",
    }, format="json").status_code == 403


def test_untreated_doctor_gets_404_on_detail(api, doctor_profile, treated, make_user, template):
    api.force_authenticate(doctor_profile.user)
    created = api.post(reverse("procedure-list"), {
        "patient": treated.patient_profile.id, "template": template.id,
    }, format="json").data

    other = make_user("doc-404@test.dev", RoleChoices.DOCTOR)
    DoctorProfile.objects.create(user=other, license_number="LIC-404")
    api.force_authenticate(other)
    # Queryset scoping hides it entirely rather than leaking existence via 403.
    assert api.get(reverse("procedure-detail", args=[created["id"]])).status_code == 404
    assert api.post(reverse("procedure-start", args=[created["id"]])).status_code == 404


def test_secretary_cannot_write_templates_but_can_read(api, secretary, template):
    api.force_authenticate(secretary)
    assert api.get(reverse("procedure-template-list")).status_code == 200
    resp = api.patch(reverse("procedure-template-detail", args=[template.id]), {"name": "x"}, format="json")
    assert resp.status_code == 403


def test_secretary_cannot_view_procedure_detail(api, doctor_profile, treated, secretary, template):
    api.force_authenticate(doctor_profile.user)
    created = api.post(reverse("procedure-list"), {
        "patient": treated.patient_profile.id, "template": template.id,
    }, format="json").data

    api.force_authenticate(secretary)
    assert api.get(reverse("procedure-detail", args=[created["id"]])).status_code == 403


# --- Unit-level model / serializer validation ------------------------------------
def test_editing_template_does_not_retroactively_change_existing_procedure(api, doctor_profile, treated, template):
    api.force_authenticate(doctor_profile.user)
    created = api.post(reverse("procedure-list"), {
        "patient": treated.patient_profile.id, "template": template.id,
    }, format="json").data

    template.checklist_template = [{"step": "A totally different step", "required": True}]
    template.name = "Renamed Template"
    template.save()

    procedure = ClinicalProcedure.objects.get(pk=created["id"])
    assert procedure.procedure_name == "Wound Suturing"
    assert len(procedure.checklist_state) == 3
    assert procedure.checklist_state[0]["step"] == "Sterilize area"


def test_checklist_state_validation_rejects_malformed_items(api, doctor_profile, treated, template):
    api.force_authenticate(doctor_profile.user)
    created = api.post(reverse("procedure-list"), {
        "patient": treated.patient_profile.id, "template": template.id,
    }, format="json").data
    api.post(reverse("procedure-start", args=[created["id"]]))

    bad = api.patch(reverse("procedure-detail", args=[created["id"]]), {
        "checklist_state": [{"required": True}],  # missing 'step'
    }, format="json")
    assert bad.status_code == 400

    bad2 = api.patch(reverse("procedure-detail", args=[created["id"]]), {
        "checklist_state": "not-a-list",
    }, format="json")
    assert bad2.status_code == 400


def test_create_requires_template_or_custom_name(api, doctor_profile, treated):
    api.force_authenticate(doctor_profile.user)
    resp = api.post(reverse("procedure-list"), {"patient": treated.patient_profile.id}, format="json")
    assert resp.status_code == 400


# --- Notifications ----------------------------------------------------------------
def test_notification_sent_on_schedule(api, doctor_profile, treated, template):
    api.force_authenticate(doctor_profile.user)
    api.post(reverse("procedure-list"), {
        "patient": treated.patient_profile.id, "template": template.id,
    }, format="json")
    assert Notification.objects.filter(recipient=treated, verb=NotificationVerb.PROCEDURE_SCHEDULED).exists()


def test_notification_sent_on_complete(api, doctor_profile, treated, template):
    api.force_authenticate(doctor_profile.user)
    created = api.post(reverse("procedure-list"), {
        "patient": treated.patient_profile.id, "template": template.id,
    }, format="json").data
    api.post(reverse("procedure-start", args=[created["id"]]))
    api.post(reverse("procedure-complete", args=[created["id"]]), {"post_procedure_notes": "done"}, format="json")
    assert Notification.objects.filter(recipient=treated, verb=NotificationVerb.PROCEDURE_COMPLETED).exists()


def test_notification_sent_on_cancel(api, doctor_profile, treated, template):
    api.force_authenticate(doctor_profile.user)
    created = api.post(reverse("procedure-list"), {
        "patient": treated.patient_profile.id, "template": template.id,
    }, format="json").data
    api.post(reverse("procedure-cancel", args=[created["id"]]), {"reason": "no longer needed"}, format="json")
    assert Notification.objects.filter(recipient=treated, verb=NotificationVerb.PROCEDURE_CANCELLED).exists()


# --- Arabic content in seed data --------------------------------------------------
def test_seed_templates_are_bilingual():
    counts = seed_procedure_templates()
    assert counts["created"] >= 1 or counts["updated"] >= 1
    templates = ProcedureTemplate.objects.filter(is_active=True)
    assert templates.exists()
    for tpl in templates:
        assert tpl.name_ar.strip(), f"Template '{tpl.name}' is missing an Arabic name"


# --- Audit coverage ----------------------------------------------------------------
def test_audit_log_records_procedure_lifecycle(api, doctor_profile, treated, template):
    api.force_authenticate(doctor_profile.user)
    created = api.post(reverse("procedure-list"), {
        "patient": treated.patient_profile.id, "template": template.id,
    }, format="json").data
    proc_id = created["id"]

    create_log = AuditLog.objects.filter(model_name="ClinicalProcedure", object_id=str(proc_id), action="CREATE").first()
    assert create_log is not None
    assert create_log.actor_id == doctor_profile.user_id

    api.post(reverse("procedure-start", args=[proc_id]))
    api.post(reverse("procedure-complete", args=[proc_id]), {"post_procedure_notes": "done"}, format="json")

    update_logs = AuditLog.objects.filter(model_name="ClinicalProcedure", object_id=str(proc_id), action="UPDATE")
    assert update_logs.count() >= 2  # start + complete transitions
    assert all(log.actor_id == doctor_profile.user_id for log in update_logs)
