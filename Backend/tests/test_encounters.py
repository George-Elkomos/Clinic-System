"""Phase 8 (Clinical Encounter) lifecycle: draft -> submit -> amend.

No dedicated test module existed for this app before; this covers the
draft-for-appointment / submit / amend service functions directly, focusing
on the appointment OneToOne link that `get_or_create_draft` depends on to
resolve `/doctor/encounters/<appointmentId>` to the right version.
"""
import pytest
from django.urls import reverse

from apps.appointments import services as appt_services
from apps.core.enums import AppointmentStatus, RoleChoices
from apps.encounters import services as encounter_services
from apps.encounters.models import Encounter, EncounterStatus

pytestmark = pytest.mark.django_db


@pytest.fixture
def manager(make_user):
    return make_user("mgr-enc@test.dev", RoleChoices.MANAGER, first_name="Man", last_name="Ager")


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
