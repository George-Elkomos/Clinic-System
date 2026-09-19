"""Django signal `raw` guards.

A fixture/data-migration load (`manage.py loaddata`, or the `dumpdata`/
`loaddata` step in `docs/postgres-production-cutover-plan.md`) deserializes
historical rows and calls `Model.save_base(raw=True, ...)` on each one — it
is replaying data, not performing a real create/update/delete. Every signal
receiver in this codebase that has a real side effect (sends a notification,
writes an audit row, cancels appointments, regenerates slots, auto-creates a
profile, mutates a different model's row) must no-op when `raw=True`, or a
future fixture/migration load will silently do all of that for real.

Every guarded receiver here is exercised twice: once via `save_base(raw=True)`
(must be a no-op) and once via the normal path (must still behave exactly as
before — proving the guard didn't break real behaviour).

`post_delete`/`pre_delete` receivers are not covered here: Django's `raw`
flag only exists for the save family (`loaddata` never deletes rows), so
there is nothing for them to guard against — see the comments left in
`apps/audit/signals.py::audit_post_delete` and
`apps/doctors/signals.py::clear_slots_for_deleted_schedule`.
"""
from datetime import time
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.utils import timezone

from apps.appointments import services as appointment_services
from apps.audit.models import AuditLog
from apps.core.enums import AbsenceType, AppointmentStatus, RoleChoices, SlotStatus
from apps.doctors.models import DoctorAbsence, TimeSlot, WorkingSchedule
from apps.notifications.models import Notification
from apps.users.models import NotificationPreference, PatientProfile, StaffProfile, User
from apps.vital_signs.models import VitalSigns

pytestmark = pytest.mark.django_db


class TestUserSignalRawGuard:
    def test_raw_save_does_not_autocreate_a_patient_profile(self):
        user = User(
            email="raw-patient-dep@test.dev", role=RoleChoices.PATIENT,
            first_name="Raw", last_name="Dep",
        )
        user.set_password("Clinic123!")
        user.save_base(raw=True)

        assert not NotificationPreference.objects.filter(user=user).exists()
        assert not PatientProfile.objects.filter(user=user).exists()

    def test_raw_save_does_not_autocreate_a_staff_profile(self):
        user = User(
            email="raw-staff-dep@test.dev", role=RoleChoices.SECRETARY,
            first_name="Raw", last_name="Staff",
        )
        user.set_password("Clinic123!")
        user.save_base(raw=True)

        assert not NotificationPreference.objects.filter(user=user).exists()
        assert not StaffProfile.objects.filter(user=user).exists()

    def test_normal_save_still_autocreates_dependents(self, make_user):
        """Regression check: the guard must not have broken the real signup path."""
        user = make_user("normal-dep@test.dev", RoleChoices.PATIENT)
        assert NotificationPreference.objects.filter(user=user).exists()
        assert PatientProfile.objects.filter(user=user).exists()


def _walk_in(patient, doctor_profile, secretary):
    return appointment_services.create_walk_in(
        patient=patient.patient_profile, doctor=doctor_profile, created_by=secretary,
    )


class TestAppointmentSignalsRawGuard:
    def test_raw_save_sends_no_notification_and_no_broadcast(
        self, patient, doctor_profile, secretary,
    ):
        appt = _walk_in(patient, doctor_profile, secretary)
        before = Notification.objects.count()

        # A real status transition — if the guard were missing, this alone
        # would be enough to fire a "confirmed" notification.
        appt.status = AppointmentStatus.CONFIRMED
        with patch("apps.appointments.signals.get_channel_layer") as mock_get_layer:
            appt.save_base(raw=True)
            assert not mock_get_layer.called

        assert Notification.objects.count() == before
        appt.refresh_from_db()
        assert appt.status == AppointmentStatus.CONFIRMED  # the raw save itself still persisted

    def test_normal_creation_and_status_change_still_notify(
        self, patient, doctor_profile, secretary,
    ):
        """Regression check: the guard must not have broken real notifications."""
        appt = _walk_in(patient, doctor_profile, secretary)
        assert Notification.objects.filter(recipient=patient).exists()  # booked notification

        before = Notification.objects.count()
        appt.status = AppointmentStatus.CONFIRMED
        appt.save(update_fields=["status", "updated_at"])
        assert Notification.objects.count() == before + 1


class TestWorkingScheduleSignalRawGuard:
    def test_raw_save_does_not_regenerate_slots(self, doctor_profile):
        slots_before = TimeSlot.objects.filter(doctor=doctor_profile).count()
        assert slots_before > 0  # the fixture's own WorkingSchedule already generated some

        schedule = WorkingSchedule.objects.filter(doctor=doctor_profile).first()
        schedule.start_time = time(1, 0)  # a real change, if it ran, clears + regenerates slots
        schedule.save_base(raw=True)

        assert TimeSlot.objects.filter(doctor=doctor_profile).count() == slots_before

    def test_normal_save_still_regenerates_slots(self, doctor_profile):
        slots_before = TimeSlot.objects.filter(doctor=doctor_profile).count()
        schedule = WorkingSchedule.objects.filter(doctor=doctor_profile).first()
        schedule.start_time = time(1, 0)
        schedule.save()
        assert TimeSlot.objects.filter(doctor=doctor_profile).count() != slots_before or slots_before == 0


class TestDoctorAbsenceSignalRawGuard:
    def test_raw_save_does_not_cancel_appointments_or_notify(
        self, patient, doctor_profile, secretary, future_slot,
    ):
        appt = appointment_services.book_slot(
            patient=patient.patient_profile, slot_id=future_slot.id, created_by=secretary,
        )
        appointment_services.confirm_appointment(appt)
        appt.refresh_from_db()
        assert appt.status == AppointmentStatus.CONFIRMED

        before = Notification.objects.count()

        # raw=True skips auto_now_add/auto_now field processing (a real
        # fixture load always supplies these explicitly from the dump, so
        # Django doesn't overwrite historical timestamps with "now") — a
        # fresh in-memory instance needs them set by hand here too.
        absence = DoctorAbsence(
            doctor=doctor_profile,
            start_date=future_slot.date,
            end_date=future_slot.date,
            reason="raw-save test",
            absence_type=AbsenceType.VACATION,
            created_by=secretary,
            notify_patients=True,
            created_at=timezone.now(),
            updated_at=timezone.now(),
        )
        absence.save_base(raw=True)

        appt.refresh_from_db()
        assert appt.status == AppointmentStatus.CONFIRMED  # not cancelled
        assert Notification.objects.count() == before  # nothing new sent

        future_slot.refresh_from_db()
        assert future_slot.status == SlotStatus.BOOKED  # not force-blocked

    def test_normal_save_still_cancels_and_notifies(
        self, patient, doctor_profile, secretary, future_slot,
    ):
        """Regression check: the guard must not have broken real absence handling."""
        appt = appointment_services.book_slot(
            patient=patient.patient_profile, slot_id=future_slot.id, created_by=secretary,
        )
        appointment_services.confirm_appointment(appt)

        before = Notification.objects.count()
        DoctorAbsence.objects.create(
            doctor=doctor_profile,
            start_date=future_slot.date,
            end_date=future_slot.date,
            reason="normal test",
            absence_type=AbsenceType.VACATION,
            created_by=secretary,
            notify_patients=True,
        )

        appt.refresh_from_db()
        assert appt.status == AppointmentStatus.CANCELLED
        assert Notification.objects.count() == before + 1


class TestVitalSignsSignalRawGuard:
    def _medical_record(self, patient, doctor_profile, appt):
        from apps.medical_records.models import MedicalRecord

        return MedicalRecord.objects.create(
            patient=patient.patient_profile, doctor=doctor_profile,
            appointment=appt, is_current=True, vitals={"already": "historical-value"},
        )

    def test_raw_save_does_not_overwrite_the_medical_record(
        self, patient, doctor_profile, secretary,
    ):
        appt = _walk_in(patient, doctor_profile, secretary)
        record = self._medical_record(patient, doctor_profile, appt)

        # raw=True skips auto_now_add/auto_now (see the DoctorAbsence test
        # above for why) — set explicitly, matching what a real fixture load
        # would supply.
        vitals = VitalSigns(
            patient=patient.patient_profile, recorded_by=secretary, appointment=appt,
            bp_systolic=120, bp_diastolic=80, heart_rate=70,
            temperature=Decimal("37.0"), respiratory_rate=16, oxygen_saturation=98,
            weight=Decimal("70.0"), height=170,
            created_at=timezone.now(), updated_at=timezone.now(),
        )
        vitals.save_base(raw=True)

        record.refresh_from_db()
        assert record.vitals == {"already": "historical-value"}  # untouched

    def test_normal_save_still_syncs_the_medical_record(
        self, patient, doctor_profile, secretary,
    ):
        """Regression check: the guard must not have broken the real CW-7 sync."""
        appt = _walk_in(patient, doctor_profile, secretary)
        record = self._medical_record(patient, doctor_profile, appt)

        VitalSigns.objects.create(
            patient=patient.patient_profile, recorded_by=secretary, appointment=appt,
            bp_systolic=120, bp_diastolic=80, heart_rate=70,
            temperature=Decimal("37.0"), respiratory_rate=16, oxygen_saturation=98,
            weight=Decimal("70.0"), height=170,
        )

        record.refresh_from_db()
        assert record.vitals["bp_systolic"] == 120
        assert record.vitals != {"already": "historical-value"}


class TestAuditSignalsRawGuard:
    def test_raw_save_writes_no_audit_log(self, doctor_profile):
        # DoctorProfile is one of the 13 audited models (see
        # apps/audit/signals.py::AUDITED_MODELS).
        before = AuditLog.objects.count()
        doctor_profile.license_number = "RAW-SAVE-TEST"
        doctor_profile.save_base(raw=True)
        assert AuditLog.objects.count() == before

    def test_normal_save_still_writes_an_audit_log(self, doctor_profile):
        before = AuditLog.objects.count()
        doctor_profile.license_number = "NORMAL-SAVE-TEST"
        doctor_profile.save()
        assert AuditLog.objects.filter(model_name="DoctorProfile", object_id=str(doctor_profile.pk)).count() >= 1
        assert AuditLog.objects.count() == before + 1
