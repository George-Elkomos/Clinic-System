"""Phase 3 verification: reminders, waitlist auto-notify, walk-in/emergency,
absence notifications, and ops RBAC."""
from datetime import timedelta

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.appointments import services
from apps.appointments.models import Appointment, WaitlistEntry
from apps.core.enums import (
    AppointmentStatus,
    AppointmentType,
    NotificationVerb,
    RoleChoices,
    SlotStatus,
    WaitlistStatus,
)
from apps.notifications.models import Notification
from apps.notifications.services import send_due_reminders

pytestmark = pytest.mark.django_db


def _book(patient, slot):
    return services.book_slot(patient=patient.patient_profile, slot_id=slot.pk)


# --- Reminders --------------------------------------------------------------
def test_reminder_24h_sent_once(patient, doctor_profile, future_slot):
    appt = _book(patient, future_slot)
    services.confirm_appointment(appt)
    # Move it to ~24h out so it lands in the reminder window.
    appt.scheduled_start = timezone.now() + timedelta(hours=24)
    appt.save(update_fields=["scheduled_start"])

    counts = send_due_reminders()
    assert counts["reminders_24h"] == 1
    assert Notification.objects.filter(
        recipient=patient, verb=NotificationVerb.APPT_REMINDER
    ).count() == 1

    appt.refresh_from_db()
    assert appt.reminder_24h_sent is True
    # Second run sends nothing.
    assert send_due_reminders()["reminders_24h"] == 0


def test_reminder_respects_preference(patient, doctor_profile, future_slot):
    patient.notification_preference.reminder_24h = False
    patient.notification_preference.save()
    appt = _book(patient, future_slot)
    services.confirm_appointment(appt)
    appt.scheduled_start = timezone.now() + timedelta(hours=24)
    appt.save(update_fields=["scheduled_start"])

    send_due_reminders()
    assert not Notification.objects.filter(verb=NotificationVerb.APPT_REMINDER).exists()
    appt.refresh_from_db()
    assert appt.reminder_24h_sent is True  # still flagged as considered


# --- Waitlist auto-notify ---------------------------------------------------
def test_waitlist_notified_on_cancellation(patient, patient2, doctor_profile, future_slot, secretary):
    appt = _book(patient, future_slot)  # books the slot for patient
    WaitlistEntry.objects.create(
        patient=patient2.patient_profile, doctor=doctor_profile,
        desired_date_from=future_slot.date, desired_date_to=future_slot.date,
    )
    services.cancel_appointment(appt, cancelled_by=secretary, reason="freeing up")

    entry = WaitlistEntry.objects.get(patient=patient2.patient_profile)
    assert entry.status == WaitlistStatus.NOTIFIED
    assert entry.notify_expires_at is not None
    assert Notification.objects.filter(
        recipient=patient2, verb=NotificationVerb.WAITLIST_OPEN
    ).exists()


# --- Walk-in + emergency ----------------------------------------------------
def test_walk_in_emergency(patient, doctor_profile, secretary):
    from apps.doctors.models import DoctorPatient

    appt = services.create_walk_in(
        patient=patient.patient_profile, doctor=doctor_profile,
        created_by=secretary, emergency=True,
    )
    assert appt.appointment_type == AppointmentType.EMERGENCY
    assert appt.priority == 10
    assert appt.status == AppointmentStatus.CHECKED_IN
    assert appt.time_slot is None
    assert DoctorPatient.objects.filter(
        doctor=doctor_profile, patient=patient.patient_profile
    ).exists()


def test_walk_in_endpoint_staff_only(api, patient, doctor_profile, secretary):
    url = reverse("appointment-walk-in")
    payload = {"patient": patient.patient_profile.id, "doctor": doctor_profile.id, "emergency": True}
    # Patient is forbidden.
    api.force_authenticate(patient)
    assert api.post(url, payload, format="json").status_code == 403
    # Secretary can.
    api.force_authenticate(secretary)
    resp = api.post(url, payload, format="json")
    assert resp.status_code == 201
    assert resp.data["appointment_type"] == "EMERGENCY"


def test_emergency_bumps_kiosk_queue(api, patient, patient2, doctor_profile, secretary):
    # A normal checked-in walk-in, then an emergency — emergency should lead.
    services.create_walk_in(patient=patient.patient_profile, doctor=doctor_profile, created_by=secretary)
    emerg = services.create_walk_in(patient=patient2.patient_profile, doctor=doctor_profile, created_by=secretary, emergency=True)
    resp = api.get(reverse("kiosk-queue", args=[doctor_profile.id]))
    assert resp.status_code == 200
    first = resp.data["queue"][0]
    assert first["is_emergency"] is True
    # Kiosk is public: it shows an opaque ticket token, never the patient's name.
    expected_token = "#" + f"{emerg.id:04X}"[-4:]
    assert first["display_name"] == expected_token
    assert patient2.first_name not in first["display_name"]
    assert emerg.priority == 10


def test_patient_directory_staff_only(api, patient, secretary):
    url = reverse("patient-directory")
    api.force_authenticate(patient)
    assert api.get(url).status_code == 403
    api.force_authenticate(secretary)
    assert api.get(url).status_code == 200


# --- Absence notifications --------------------------------------------------
def test_absence_emits_single_absence_notification(patient, doctor_profile, future_slot, secretary):
    from apps.doctors.models import DoctorAbsence

    appt = _book(patient, future_slot)
    services.confirm_appointment(appt)
    DoctorAbsence.objects.create(
        doctor=doctor_profile, start_date=future_slot.date, end_date=future_slot.date,
        reason="Conference", created_by=secretary,
    )
    appt.refresh_from_db()
    assert appt.status == AppointmentStatus.CANCELLED
    future_slot.refresh_from_db()
    assert future_slot.status == SlotStatus.BLOCKED

    assert Notification.objects.filter(recipient=patient, verb=NotificationVerb.ABSENCE).count() == 1
    # No duplicate generic cancellation notification.
    assert not Notification.objects.filter(recipient=patient, verb=NotificationVerb.APPT_CANCELLED).exists()
