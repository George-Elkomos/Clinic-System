"""Regression tests for the "my-queue" UTC-vs-local day boundary bug: an
early-morning appointment (e.g. 2 AM Africa/Cairo) must still show up in the
doctor's live queue on "today", even though its UTC instant falls on the
previous calendar day. See apps/appointments/views.py's `my_queue`/
`queue_position` actions -- both must derive "today" via timezone.localdate()/
timezone.localtime(), never a bare timezone.now().date() or aware_dt.date().
"""
from datetime import timedelta, timezone as datetime_timezone
from unittest.mock import patch

from django.urls import reverse
from django.utils import timezone

from apps.appointments.models import Appointment
from apps.core.enums import AppointmentStatus


def _cairo_midnight_ish():
    """Returns (scheduled_instant, mocked_now) for 00:30 local time "today"
    in Africa/Cairo -- the exact window where a bare `timezone.now().date()`
    (UTC) disagrees with `timezone.localdate()` (Cairo), since Cairo's
    calendar day has already rolled over while UTC's hasn't.

    `mocked_now` is explicitly re-expressed with UTC tzinfo (not Cairo) to
    faithfully match what `django.utils.timezone.now()` actually returns in
    this app (USE_TZ=True always hands back a UTC-tzinfo datetime, regardless
    of settings.TIME_ZONE) -- mocking it with Cairo tzinfo instead would make
    `.date()` silently give the correct local date and mask the bug.
    """
    now_local_date = timezone.localdate()
    local_instant = timezone.make_aware(
        timezone.datetime.combine(now_local_date, timezone.datetime.min.time()) + timedelta(minutes=30),
        timezone.get_current_timezone(),
    )
    mocked_now = local_instant.astimezone(datetime_timezone.utc)
    assert mocked_now.date() < now_local_date, (
        "test precondition: Cairo's UTC offset must push local midnight+30m "
        "into the previous UTC calendar day"
    )
    return local_instant, mocked_now


def test_my_queue_includes_early_morning_confirmed_appointment(api, patient, doctor_profile):
    scheduled, mocked_now = _cairo_midnight_ish()
    appt = Appointment.objects.create(
        patient=patient.patient_profile, doctor=doctor_profile,
        scheduled_start=scheduled, scheduled_end=scheduled + timedelta(minutes=30),
        status=AppointmentStatus.CONFIRMED,
    )
    # Freeze "now" to the same early-morning instant so timezone.now().date()
    # (UTC) and timezone.localdate() (Cairo) actually disagree during the test.
    with patch("django.utils.timezone.now", return_value=mocked_now):
        api.force_authenticate(user=doctor_profile.user)
        resp = api.get(reverse("appointment-my-queue"))
    assert resp.status_code == 200
    assert resp.data["next"] is not None
    assert resp.data["next"]["id"] == appt.id
    assert resp.data["waiting_count"] == 1


def test_queue_position_for_early_morning_appointment(api, patient, doctor_profile):
    scheduled, mocked_now = _cairo_midnight_ish()
    appt = Appointment.objects.create(
        patient=patient.patient_profile, doctor=doctor_profile,
        scheduled_start=scheduled, scheduled_end=scheduled + timedelta(minutes=30),
        status=AppointmentStatus.CONFIRMED,
    )
    with patch("django.utils.timezone.now", return_value=mocked_now):
        api.force_authenticate(user=doctor_profile.user)
        resp = api.get(reverse("appointment-queue-position", args=[appt.id]))
    assert resp.status_code == 200
    assert resp.data["total_waiting"] == 1
    assert resp.data["position"] == 1
