"""Auto-cancel (PENDING -> EXPIRED, CONFIRMED -> NO_SHOW) sweeps and the
patient reliability score they feed."""
from datetime import timedelta

import pytest
from django.conf import settings
from django.utils import timezone

from apps.appointments import services
from apps.appointments.models import Appointment
from apps.core.enums import AppointmentStatus, SlotStatus
from apps.notifications.models import Notification
from apps.users.services import patient_reliability

pytestmark = pytest.mark.django_db


def _book(patient, slot):
    return services.book_slot(patient=patient.patient_profile, slot_id=slot.pk)


# --- Auto-expiry (PENDING -> EXPIRED) ----------------------------------------

def test_expire_due_appointments_expires_overdue_pending(patient, future_slot, secretary):
    appt = _book(patient, future_slot)
    grace = settings.PENDING_EXPIRY_GRACE_MINUTES
    appt.scheduled_start = timezone.now() - timedelta(minutes=grace + 1)
    appt.save(update_fields=["scheduled_start"])

    count = services.expire_due_appointments()

    appt.refresh_from_db()
    future_slot.refresh_from_db()
    assert count == 1
    assert appt.status == AppointmentStatus.EXPIRED
    assert appt.time_slot is None
    # The underlying slot's own start_datetime is still in the future (only
    # the appointment's denormalized scheduled_start was pushed into the
    # past above), so it's freed back to AVAILABLE, not PAST.
    assert future_slot.status == SlotStatus.AVAILABLE
    assert Notification.objects.filter(recipient=secretary, verb="APPT_EXPIRED").exists()


def test_expire_due_appointments_leaves_pending_inside_grace_window(patient, future_slot):
    appt = _book(patient, future_slot)  # scheduled_start is safely in the future
    count = services.expire_due_appointments()
    appt.refresh_from_db()
    assert count == 0
    assert appt.status == AppointmentStatus.PENDING


def test_expire_due_appointments_ignores_confirmed(patient, future_slot):
    appt = _book(patient, future_slot)
    services.confirm_appointment(appt)
    grace = settings.PENDING_EXPIRY_GRACE_MINUTES
    appt.scheduled_start = timezone.now() - timedelta(minutes=grace + 1)
    appt.save(update_fields=["scheduled_start"])

    count = services.expire_due_appointments()

    appt.refresh_from_db()
    assert count == 0
    assert appt.status == AppointmentStatus.CONFIRMED


# --- Auto no-show (CONFIRMED -> NO_SHOW) -------------------------------------

def test_mark_overdue_no_shows_marks_confirmed_past_grace(patient, future_slot, secretary):
    appt = _book(patient, future_slot)
    services.confirm_appointment(appt)
    grace = settings.NO_SHOW_GRACE_MINUTES
    appt.scheduled_start = timezone.now() - timedelta(minutes=grace + 1)
    appt.scheduled_end = appt.scheduled_start + timedelta(minutes=30)
    appt.save(update_fields=["scheduled_start", "scheduled_end"])

    count = services.mark_overdue_no_shows()

    appt.refresh_from_db()
    assert count == 1
    assert appt.status == AppointmentStatus.NO_SHOW
    assert Notification.objects.filter(recipient=secretary, verb="APPT_NO_SHOW").exists()


def test_mark_overdue_no_shows_leaves_confirmed_inside_grace_window(patient, future_slot):
    appt = _book(patient, future_slot)
    services.confirm_appointment(appt)  # scheduled_start is safely in the future

    count = services.mark_overdue_no_shows()

    appt.refresh_from_db()
    assert count == 0
    assert appt.status == AppointmentStatus.CONFIRMED


def test_mark_overdue_no_shows_does_not_touch_checked_in(patient, future_slot):
    appt = _book(patient, future_slot)
    services.confirm_appointment(appt)
    grace = settings.NO_SHOW_GRACE_MINUTES
    appt.status = AppointmentStatus.CHECKED_IN
    appt.scheduled_start = timezone.now() - timedelta(minutes=grace + 1)
    appt.scheduled_end = appt.scheduled_start + timedelta(minutes=30)
    appt.save()

    count = services.mark_overdue_no_shows()

    appt.refresh_from_db()
    assert count == 0
    assert appt.status == AppointmentStatus.CHECKED_IN


# --- Patient reliability score ------------------------------------------------

def _past_no_show(profile, doctor_profile, status=AppointmentStatus.NO_SHOW):
    start = timezone.now() - timedelta(days=1)
    return Appointment.objects.create(
        patient=profile, doctor=doctor_profile,
        scheduled_start=start, scheduled_end=start + timedelta(minutes=30),
        status=status,
    )


def test_reliability_defaults_to_good(patient):
    assert patient_reliability(patient.patient_profile) == {"score": 100, "label": "GOOD"}


def test_reliability_drops_per_no_show(patient, doctor_profile):
    profile = patient.patient_profile
    _past_no_show(profile, doctor_profile)
    _past_no_show(profile, doctor_profile)
    assert patient_reliability(profile) == {"score": 50, "label": "WATCH"}


def test_reliability_high_risk_below_50(patient, doctor_profile):
    profile = patient.patient_profile
    for _ in range(3):
        _past_no_show(profile, doctor_profile)
    assert patient_reliability(profile) == {"score": 25, "label": "HIGH_RISK"}


def test_reliability_ignores_cancelled(patient, doctor_profile):
    profile = patient.patient_profile
    _past_no_show(profile, doctor_profile, status=AppointmentStatus.CANCELLED)
    assert patient_reliability(profile) == {"score": 100, "label": "GOOD"}


def test_reliability_drops_per_expired(patient, doctor_profile):
    profile = patient.patient_profile
    _past_no_show(profile, doctor_profile, status=AppointmentStatus.EXPIRED)
    _past_no_show(profile, doctor_profile, status=AppointmentStatus.EXPIRED)
    assert patient_reliability(profile) == {"score": 50, "label": "WATCH"}


def test_reliability_combines_no_show_and_expired(patient, doctor_profile):
    profile = patient.patient_profile
    _past_no_show(profile, doctor_profile, status=AppointmentStatus.NO_SHOW)
    _past_no_show(profile, doctor_profile, status=AppointmentStatus.EXPIRED)
    assert patient_reliability(profile) == {"score": 50, "label": "WATCH"}
