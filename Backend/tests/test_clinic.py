"""Phase-1 verification tests: auth, RBAC scoping, slot generation, booking."""
from datetime import timedelta

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.appointments import services
from apps.appointments.models import Appointment
from apps.core.enums import AppointmentStatus, SlotStatus
from apps.doctors.services import slot_generator

pytestmark = pytest.mark.django_db


# --- Auth -------------------------------------------------------------------
def test_login_returns_access_and_sets_refresh_cookie(api, patient):
    resp = api.post(reverse("auth-login"),
                    {"email": patient.email, "password": "Clinic123!"}, format="json")
    assert resp.status_code == 200
    assert "access" in resp.data
    assert "refresh" not in resp.data  # refresh lives in the httpOnly cookie only
    assert resp.data["user"]["role"] == "PATIENT"
    from django.conf import settings
    assert settings.JWT_REFRESH_COOKIE in resp.cookies


def test_me_requires_auth(api):
    assert api.get(reverse("auth-me")).status_code == 401


def test_me_returns_profile(api, patient):
    api.force_authenticate(patient)
    resp = api.get(reverse("auth-me"))
    assert resp.status_code == 200
    assert resp.data["email"] == patient.email
    assert resp.data["patient_profile"] is not None  # auto-created by signal
    assert resp.data["must_change_password"] is False


def test_login_surfaces_must_change_password_flag(api, patient):
    patient.must_change_password = True
    patient.save(update_fields=["must_change_password"])
    resp = api.post(reverse("auth-login"),
                     {"email": patient.email, "password": "Clinic123!"}, format="json")
    assert resp.status_code == 200
    assert resp.data["user"]["must_change_password"] is True


def test_change_password_requires_correct_current_password(api, patient):
    api.force_authenticate(patient)
    resp = api.post(reverse("auth-change-password"), {
        "current_password": "WrongPass1!", "new_password": "NewSecurePass1!",
    }, format="json")
    assert resp.status_code == 400


def test_change_password_clears_must_change_password_flag(api, patient):
    patient.must_change_password = True
    patient.save(update_fields=["must_change_password"])
    api.force_authenticate(patient)
    resp = api.post(reverse("auth-change-password"), {
        "current_password": "Clinic123!", "new_password": "NewSecurePass1!",
    }, format="json")
    assert resp.status_code == 200
    patient.refresh_from_db()
    assert patient.must_change_password is False
    login_resp = api.post(reverse("auth-login"), {
        "email": patient.email, "password": "NewSecurePass1!",
    }, format="json")
    assert login_resp.status_code == 200


# --- RBAC scoping -----------------------------------------------------------
def _book(patient, slot):
    return services.book_slot(patient=patient.patient_profile, slot_id=slot.pk)


def test_patient_cannot_see_another_patients_appointment(api, patient, patient2, future_slot):
    appt = _book(patient, future_slot)
    api.force_authenticate(patient2)
    # Not in the list...
    list_resp = api.get(reverse("appointment-list"))
    assert all(a["id"] != appt.id for a in list_resp.data["results"])
    # ...and not retrievable (queryset-scoped -> 404).
    assert api.get(reverse("appointment-detail", args=[appt.id])).status_code == 404


def test_doctor_sees_only_own_appointments(api, patient, doctor_profile, future_slot, make_user):
    from apps.core.enums import RoleChoices
    from apps.doctors.models import DoctorProfile

    appt = _book(patient, future_slot)  # belongs to doctor_profile
    other_user = make_user("doc2@test.dev", RoleChoices.DOCTOR)
    DoctorProfile.objects.create(user=other_user, license_number="LIC-T2")

    api.force_authenticate(doctor_profile.user)
    assert any(a["id"] == appt.id for a in api.get(reverse("appointment-list")).data["results"])

    api.force_authenticate(other_user)
    assert all(a["id"] != appt.id for a in api.get(reverse("appointment-list")).data["results"])


def test_only_manager_reads_audit_log(api, patient, secretary, make_user):
    from apps.core.enums import RoleChoices

    manager = make_user("mgr@test.dev", RoleChoices.MANAGER)
    api.force_authenticate(patient)
    assert api.get(reverse("audit-log-list")).status_code == 403
    api.force_authenticate(secretary)
    assert api.get(reverse("audit-log-list")).status_code == 403
    api.force_authenticate(manager)
    assert api.get(reverse("audit-log-list")).status_code == 200


# --- Slot generation --------------------------------------------------------
def test_slot_generation_is_idempotent(doctor_profile):
    from apps.doctors.models import TimeSlot

    today = timezone.localdate()
    end = today + timedelta(days=1)
    # Slots may already exist (the WorkingSchedule save-signal generates them).
    slot_generator.generate_slots_for_doctor(doctor_profile, today, end)
    count1 = TimeSlot.objects.filter(doctor=doctor_profile).count()
    second = slot_generator.generate_slots_for_doctor(doctor_profile, today, end)
    count2 = TimeSlot.objects.filter(doctor=doctor_profile).count()
    assert count1 > 0
    assert second == 0 and count2 == count1  # re-running creates nothing new


# --- Booking ----------------------------------------------------------------
def test_booking_marks_slot_and_creates_pending(patient, future_slot):
    appt = _book(patient, future_slot)
    future_slot.refresh_from_db()
    assert appt.status == AppointmentStatus.PENDING
    assert future_slot.status == SlotStatus.BOOKED


def test_double_booking_is_rejected(patient, patient2, future_slot):
    from rest_framework.exceptions import ValidationError

    _book(patient, future_slot)
    with pytest.raises(ValidationError):
        _book(patient2, future_slot)


def test_cancelled_slot_can_be_rebooked(patient, patient2, future_slot):
    # Cancelling frees the slot (and releases the O2O) so it can be rebooked.
    appt = _book(patient, future_slot)
    services.cancel_appointment(appt, cancelled_by=patient, reason="changed mind")
    future_slot.refresh_from_db()
    assert future_slot.status == SlotStatus.AVAILABLE
    appt.refresh_from_db()
    assert appt.time_slot is None
    rebooked = _book(patient2, future_slot)  # must not raise IntegrityError
    assert rebooked.status == AppointmentStatus.PENDING


def test_confirm_transitions_to_confirmed(patient, future_slot):
    appt = _book(patient, future_slot)
    services.confirm_appointment(appt)
    appt.refresh_from_db()
    assert appt.status == AppointmentStatus.CONFIRMED


def test_complete_records_doctor_patient_link(patient, doctor_profile, future_slot):
    from apps.doctors.models import DoctorPatient

    appt = _book(patient, future_slot)
    services.complete_appointment(appt)
    assert DoctorPatient.objects.filter(
        doctor=doctor_profile, patient=patient.patient_profile
    ).exists()


# --- Kiosk (public, no auth) ------------------------------------------------
def test_kiosk_is_public(api, patient, doctor_profile, future_slot):
    appt = _book(patient, future_slot)
    appt.status = AppointmentStatus.IN_PROGRESS
    appt.scheduled_start = timezone.now()
    appt.save()
    resp = api.get(reverse("kiosk-queue", args=[doctor_profile.id]))
    assert resp.status_code == 200
    assert resp.data["doctor"]["id"] == doctor_profile.id


# --- Status-transition guards: check-in / start / complete -------------------
# These three actions must reject out-of-order transitions via the API even
# though the frontend's happy path never exposes the button in the wrong
# state -- a stale tab, a replayed request, or a buggy client shouldn't be
# able to force an appointment through the pipeline out of sequence.

def test_check_in_rejected_from_pending(api, patient, doctor_profile, future_slot, secretary):
    appt = _book(patient, future_slot)  # still PENDING, never confirmed
    api.force_authenticate(secretary)
    resp = api.post(reverse("appointment-check-in", args=[appt.id]))
    assert resp.status_code == 400
    appt.refresh_from_db()
    assert appt.status == AppointmentStatus.PENDING


def test_check_in_succeeds_from_confirmed(api, patient, doctor_profile, future_slot, secretary):
    appt = _book(patient, future_slot)
    services.confirm_appointment(appt)
    api.force_authenticate(secretary)
    resp = api.post(reverse("appointment-check-in", args=[appt.id]))
    assert resp.status_code == 200
    appt.refresh_from_db()
    assert appt.status == AppointmentStatus.CHECKED_IN
    assert appt.checked_in_at is not None


def test_check_in_rejected_when_already_checked_in(api, patient, doctor_profile, future_slot, secretary):
    appt = _book(patient, future_slot)
    services.confirm_appointment(appt)
    api.force_authenticate(secretary)
    assert api.post(reverse("appointment-check-in", args=[appt.id])).status_code == 200
    resp = api.post(reverse("appointment-check-in", args=[appt.id]))  # re-check-in
    assert resp.status_code == 400


def test_check_in_rejected_from_completed(api, patient, doctor_profile, future_slot, secretary):
    appt = _book(patient, future_slot)
    appt.status = AppointmentStatus.COMPLETED
    appt.save(update_fields=["status"])
    api.force_authenticate(secretary)
    resp = api.post(reverse("appointment-check-in", args=[appt.id]))
    assert resp.status_code == 400


def test_start_succeeds_from_confirmed(api, patient, doctor_profile, future_slot):
    # The doctor's "Call Next Patient" can pull straight from CONFIRMED,
    # skipping a front-desk check-in.
    appt = _book(patient, future_slot)
    services.confirm_appointment(appt)
    api.force_authenticate(doctor_profile.user)
    resp = api.post(reverse("appointment-start", args=[appt.id]))
    assert resp.status_code == 200
    appt.refresh_from_db()
    assert appt.status == AppointmentStatus.IN_PROGRESS
    assert appt.started_at is not None


def test_start_succeeds_from_checked_in(api, patient, doctor_profile, future_slot, secretary):
    appt = _book(patient, future_slot)
    services.confirm_appointment(appt)
    api.force_authenticate(secretary)
    api.post(reverse("appointment-check-in", args=[appt.id]))
    api.force_authenticate(doctor_profile.user)
    resp = api.post(reverse("appointment-start", args=[appt.id]))
    assert resp.status_code == 200
    appt.refresh_from_db()
    assert appt.status == AppointmentStatus.IN_PROGRESS


def test_start_rejected_from_pending(api, patient, doctor_profile, future_slot):
    appt = _book(patient, future_slot)  # never confirmed
    api.force_authenticate(doctor_profile.user)
    resp = api.post(reverse("appointment-start", args=[appt.id]))
    assert resp.status_code == 400
    appt.refresh_from_db()
    assert appt.status == AppointmentStatus.PENDING


def test_start_rejected_from_completed(api, patient, doctor_profile, future_slot):
    appt = _book(patient, future_slot)
    appt.status = AppointmentStatus.COMPLETED
    appt.save(update_fields=["status"])
    api.force_authenticate(doctor_profile.user)
    resp = api.post(reverse("appointment-start", args=[appt.id]))
    assert resp.status_code == 400


def test_start_rejected_from_cancelled(api, patient, doctor_profile, future_slot):
    appt = _book(patient, future_slot)
    services.cancel_appointment(appt, cancelled_by=patient, reason="changed mind")
    api.force_authenticate(doctor_profile.user)
    resp = api.post(reverse("appointment-start", args=[appt.id]))
    assert resp.status_code == 400


def test_complete_succeeds_from_in_progress(api, patient, doctor_profile, future_slot):
    """A documented encounter is required (Finding #3) -- see the
    test_complete_rejected_* cases below for the undocumented paths."""
    from apps.encounters import services as encounter_services

    appt = _book(patient, future_slot)
    appt.status = AppointmentStatus.IN_PROGRESS
    appt.save(update_fields=["status"])
    encounter = encounter_services.get_or_create_draft(appointment=appt, doctor=doctor_profile)
    encounter.chief_complaint = "Headache"
    encounter.save(update_fields=["chief_complaint"])

    api.force_authenticate(doctor_profile.user)
    resp = api.post(reverse("appointment-complete", args=[appt.id]))
    assert resp.status_code == 200
    appt.refresh_from_db()
    assert appt.status == AppointmentStatus.COMPLETED


def test_complete_rejected_without_any_encounter(api, patient, doctor_profile, future_slot):
    """Regression test for Finding #3's second entry point: the queue's direct
    "Complete Visit" action (AppointmentViewSet.complete) used to skip straight
    to complete_appointment() with no encounter at all, bypassing the same
    zero-clinical-content guard enforced on the encounter submit path."""
    appt = _book(patient, future_slot)
    appt.status = AppointmentStatus.IN_PROGRESS
    appt.save(update_fields=["status"])

    api.force_authenticate(doctor_profile.user)
    resp = api.post(reverse("appointment-complete", args=[appt.id]))
    assert resp.status_code == 400
    appt.refresh_from_db()
    assert appt.status == AppointmentStatus.IN_PROGRESS


def test_complete_rejected_with_empty_encounter(api, patient, doctor_profile, future_slot):
    from apps.encounters import services as encounter_services

    appt = _book(patient, future_slot)
    appt.status = AppointmentStatus.IN_PROGRESS
    appt.save(update_fields=["status"])
    encounter_services.get_or_create_draft(appointment=appt, doctor=doctor_profile)  # left blank

    api.force_authenticate(doctor_profile.user)
    resp = api.post(reverse("appointment-complete", args=[appt.id]))
    assert resp.status_code == 400
    appt.refresh_from_db()
    assert appt.status == AppointmentStatus.IN_PROGRESS


@pytest.mark.parametrize("bad_status", [
    AppointmentStatus.PENDING,
    AppointmentStatus.CONFIRMED,
    AppointmentStatus.CHECKED_IN,
    AppointmentStatus.COMPLETED,
    AppointmentStatus.CANCELLED,
    AppointmentStatus.NO_SHOW,
])
def test_complete_rejected_from_non_in_progress(api, patient, doctor_profile, future_slot, bad_status):
    appt = _book(patient, future_slot)
    appt.status = bad_status
    appt.save(update_fields=["status"])
    api.force_authenticate(doctor_profile.user)
    resp = api.post(reverse("appointment-complete", args=[appt.id]))
    assert resp.status_code == 400
    appt.refresh_from_db()
    assert appt.status == bad_status  # unchanged
