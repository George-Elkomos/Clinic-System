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
