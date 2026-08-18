"""Phase 8 (Clinical Encounter) lifecycle: draft -> submit -> amend.

No dedicated test module existed for this app before; this covers the
draft-for-appointment / submit / amend service functions directly, focusing
on the appointment OneToOne link that `get_or_create_draft` depends on to
resolve `/doctor/encounters/<appointmentId>` to the right version.
"""
import pytest
from django.urls import reverse
from django.utils import timezone

from apps.appointments import services as appt_services
from apps.core.enums import AppointmentStatus, AppointmentType, RoleChoices
from apps.encounters import services as encounter_services
from apps.encounters.models import Diagnosis, Encounter, EncounterStatus

pytestmark = pytest.mark.django_db


@pytest.fixture
def manager(make_user):
    return make_user("mgr-enc@test.dev", RoleChoices.MANAGER, first_name="Man", last_name="Ager")


@pytest.fixture
def diagnosis(db):
    return Diagnosis.objects.create(name="Common cold")


def _completed_appointment(patient, doctor_profile, future_slot):
    appt = appt_services.book_slot(patient=patient.patient_profile, slot_id=future_slot.pk)
    appt_services.confirm_appointment(appt)
    appt.status = AppointmentStatus.IN_PROGRESS
    appt.save(update_fields=["status"])
    return appt


def test_draft_for_appointment_creates_then_reuses(patient, doctor_profile, future_slot):
    appt = _completed_appointment(patient, doctor_profile, future_slot)
    first = encounter_services.get_or_create_draft(appointment=appt, doctor=doctor_profile)
    again = encounter_services.get_or_create_draft(appointment=appt, doctor=doctor_profile)
    assert first.id == again.id
    assert first.status == EncounterStatus.DRAFT


def test_submit_completes_appointment_and_locks_encounter(patient, doctor_profile, future_slot):
    appt = _completed_appointment(patient, doctor_profile, future_slot)
    draft = encounter_services.get_or_create_draft(appointment=appt, doctor=doctor_profile)
    draft.chief_complaint = "Headache"
    draft.save(update_fields=["chief_complaint"])
    encounter_services.submit_encounter(draft)
    draft.refresh_from_db()
    appt.refresh_from_db()
    assert draft.status == EncounterStatus.SUBMITTED
    assert appt.status == AppointmentStatus.COMPLETED


def test_amend_moves_appointment_link_to_the_new_current_twin(patient, doctor_profile, future_slot):
    """Regression test: the appointment OneToOne must follow whichever version
    is current. Before the fix, amend() left it on the superseded original,
    so `get_or_create_draft` (and the UI's encounter links) kept resolving to
    stale pre-amendment content forever."""
    appt = _completed_appointment(patient, doctor_profile, future_slot)
    original = encounter_services.get_or_create_draft(appointment=appt, doctor=doctor_profile)
    original.chief_complaint = "Headache"
    original.save(update_fields=["chief_complaint"])
    encounter_services.submit_encounter(original)

    twin = encounter_services.amend_encounter(original)

    original.refresh_from_db()
    assert original.status == EncounterStatus.AMENDED
    assert original.is_current is False
    assert original.appointment_id is None

    assert twin.status == EncounterStatus.DRAFT
    assert twin.is_current is True
    assert twin.appointment_id == appt.id
    assert twin.supersedes_id == original.id

    # The whole point: looking the encounter up by appointment again must
    # resolve to the twin, not the stale original.
    resolved = encounter_services.get_or_create_draft(appointment=appt, doctor=doctor_profile)
    assert resolved.id == twin.id


def test_amend_rejects_non_submitted_encounter(patient, doctor_profile, future_slot):
    from rest_framework.exceptions import ValidationError

    appt = _completed_appointment(patient, doctor_profile, future_slot)
    draft = encounter_services.get_or_create_draft(appointment=appt, doctor=doctor_profile)
    with pytest.raises(ValidationError):
        encounter_services.amend_encounter(draft)


def test_double_amend_chain_keeps_appointment_on_latest(patient, doctor_profile, future_slot):
    appt = _completed_appointment(patient, doctor_profile, future_slot)
    v1 = encounter_services.get_or_create_draft(appointment=appt, doctor=doctor_profile)
    v1.chief_complaint = "Headache"
    v1.save(update_fields=["chief_complaint"])
    encounter_services.submit_encounter(v1)
    v2 = encounter_services.amend_encounter(v1)
    encounter_services.submit_encounter(v2)
    v3 = encounter_services.amend_encounter(v2)

    v1.refresh_from_db()
    v2.refresh_from_db()
    assert v1.appointment_id is None
    assert v2.appointment_id is None
    assert v3.appointment_id == appt.id
    assert Encounter.objects.filter(appointment=appt).count() == 1


def test_submit_rejects_encounter_with_zero_clinical_content(patient, doctor_profile, future_slot):
    appt = _completed_appointment(patient, doctor_profile, future_slot)
    draft = encounter_services.get_or_create_draft(appointment=appt, doctor=doctor_profile)

    from rest_framework.exceptions import ValidationError

    with pytest.raises(ValidationError):
        encounter_services.submit_encounter(draft)

    draft.refresh_from_db()
    appt.refresh_from_db()
    assert draft.status == EncounterStatus.DRAFT
    assert appt.status != AppointmentStatus.COMPLETED


@pytest.mark.parametrize(
    "fields",
    [
        {"chief_complaint": "Headache"},
        {"diagnosis_notes": "Likely tension headache."},
        {"treatment_plan": "Rest and hydration."},
        {"examination_findings": "No focal deficits."},
    ],
)
def test_submit_accepts_encounter_with_any_single_clinical_field(
    patient, doctor_profile, future_slot, fields,
):
    appt = _completed_appointment(patient, doctor_profile, future_slot)
    draft = encounter_services.get_or_create_draft(appointment=appt, doctor=doctor_profile)
    for field, value in fields.items():
        setattr(draft, field, value)
    draft.save(update_fields=list(fields))

    encounter_services.submit_encounter(draft)
    draft.refresh_from_db()
    assert draft.status == EncounterStatus.SUBMITTED


def test_submit_accepts_encounter_with_only_a_diagnosis(patient, doctor_profile, future_slot, diagnosis):
    appt = _completed_appointment(patient, doctor_profile, future_slot)
    draft = encounter_services.get_or_create_draft(appointment=appt, doctor=doctor_profile)
    draft.diagnosis = diagnosis
    draft.save(update_fields=["diagnosis"])

    encounter_services.submit_encounter(draft)
    draft.refresh_from_db()
    assert draft.status == EncounterStatus.SUBMITTED


def test_submit_endpoint_returns_400_for_empty_encounter(api, doctor_profile, patient, future_slot):
    appt = _completed_appointment(patient, doctor_profile, future_slot)
    draft = encounter_services.get_or_create_draft(appointment=appt, doctor=doctor_profile)

    api.force_authenticate(doctor_profile.user)
    resp = api.post(reverse("encounter-submit", args=[draft.id]))
    assert resp.status_code == 400

    draft.refresh_from_db()
    assert draft.status == EncounterStatus.DRAFT


def test_submit_endpoint_returns_200_for_encounter_with_content(api, doctor_profile, patient, future_slot):
    appt = _completed_appointment(patient, doctor_profile, future_slot)
    draft = encounter_services.get_or_create_draft(appointment=appt, doctor=doctor_profile)
    draft.chief_complaint = "Sore throat"
    draft.save(update_fields=["chief_complaint"])

    api.force_authenticate(doctor_profile.user)
    resp = api.post(reverse("encounter-submit", args=[draft.id]))
    assert resp.status_code == 200
    assert resp.data["status"] == EncounterStatus.SUBMITTED


def test_manager_cannot_edit_draft_encounter(api, manager, patient, doctor_profile, future_slot):
    """Regression: EncounterPermission used to grant managers unconditional
    object-level access, letting them PATCH clinical encounter content via the
    API even though encounters are doctor-exclusive. Managers keep read access."""
    appt = _completed_appointment(patient, doctor_profile, future_slot)
    draft = encounter_services.get_or_create_draft(appointment=appt, doctor=doctor_profile)

    api.force_authenticate(manager)
    resp = api.patch(reverse("encounter-detail", args=[draft.id]), {}, format="json")
    assert resp.status_code == 403

    resp = api.get(reverse("encounter-detail", args=[draft.id]))
    assert resp.status_code == 200


def test_manager_cannot_submit_or_amend_encounter(api, manager, patient, doctor_profile, future_slot):
    appt = _completed_appointment(patient, doctor_profile, future_slot)
    draft = encounter_services.get_or_create_draft(appointment=appt, doctor=doctor_profile)

    api.force_authenticate(manager)
    resp = api.post(reverse("encounter-submit", args=[draft.id]))
    assert resp.status_code == 403

    draft.chief_complaint = "Headache"
    draft.save(update_fields=["chief_complaint"])
    encounter_services.submit_encounter(draft)
    draft.refresh_from_db()
    resp = api.post(reverse("encounter-amend", args=[draft.id]))
    assert resp.status_code == 403


def test_doctor_can_still_edit_own_draft_encounter(api, doctor_profile, patient, future_slot):
    """Guard against overcorrecting the manager-write fix above."""
    appt = _completed_appointment(patient, doctor_profile, future_slot)
    draft = encounter_services.get_or_create_draft(appointment=appt, doctor=doctor_profile)

    api.force_authenticate(doctor_profile.user)
    resp = api.patch(
        reverse("encounter-detail", args=[draft.id]),
        {"chief_complaint": "Headache"},
        format="json",
    )
    assert resp.status_code == 200
    assert resp.data["chief_complaint"] == "Headache"


# --- Follow-up context: previous_encounter -----------------------------------
# A Follow-up encounter should carry the origin visit's diagnosis/treatment/
# notes forward (EncounterReadSerializer.get_previous_encounter), resolved
# through the FollowUp record's origin_appointment -- so the doctor has it
# without leaving the encounter page. A plain scheduled visit never does.

def test_previous_encounter_surfaces_on_followup_only(api, patient, doctor_profile, future_slot, diagnosis):
    origin = _completed_appointment(patient, doctor_profile, future_slot)
    origin_draft = encounter_services.get_or_create_draft(appointment=origin, doctor=doctor_profile)
    origin_draft.chief_complaint = "Sore throat"
    origin_draft.diagnosis = diagnosis
    origin_draft.treatment_plan = "Rest and fluids"
    origin_draft.save(update_fields=["chief_complaint", "diagnosis", "treatment_plan"])
    encounter_services.submit_encounter(origin_draft)

    followup = appt_services.create_followup(
        origin_appointment=origin, recommended_date=timezone.localdate(),
    )
    resulting = appt_services.confirm_followup(followup)
    assert resulting.appointment_type == AppointmentType.FOLLOW_UP

    followup_draft = encounter_services.get_or_create_draft(appointment=resulting, doctor=doctor_profile)

    api.force_authenticate(doctor_profile.user)
    resp = api.get(reverse("encounter-detail", args=[followup_draft.id]))
    assert resp.status_code == 200
    assert resp.data["appointment_type"] == AppointmentType.FOLLOW_UP
    previous = resp.data["previous_encounter"]
    assert previous is not None
    assert previous["chief_complaint"] == "Sore throat"
    assert previous["treatment_plan"] == "Rest and fluids"
    assert previous["diagnosis_detail"]["id"] == diagnosis.id


def test_previous_encounter_absent_for_non_followup(api, patient, doctor_profile, future_slot):
    appt = _completed_appointment(patient, doctor_profile, future_slot)
    draft = encounter_services.get_or_create_draft(appointment=appt, doctor=doctor_profile)

    api.force_authenticate(doctor_profile.user)
    resp = api.get(reverse("encounter-detail", args=[draft.id]))
    assert resp.status_code == 200
    assert resp.data["previous_encounter"] is None


def test_submit_response_includes_billing_outcome(api, doctor_profile, patient, future_slot):
    """"Submit & Close Encounter" is the doctor's only completion path now (the
    queue's direct "Complete Visit" button was removed) -- its response has to
    carry the same billing outcome that button used to return."""
    appt = _completed_appointment(patient, doctor_profile, future_slot)
    draft = encounter_services.get_or_create_draft(appointment=appt, doctor=doctor_profile)

    api.force_authenticate(doctor_profile.user)
    api.patch(reverse("encounter-detail", args=[draft.id]), {"chief_complaint": "Headache"}, format="json")
    resp = api.post(reverse("encounter-submit", args=[draft.id]))
    assert resp.status_code == 200
    assert "billing" in resp.data
    assert "invoice_id" in resp.data["billing"]
