from datetime import time

import pytest
from django.utils import timezone

from apps.core.enums import RoleChoices, SlotStatus
from apps.doctors.models import DoctorProfile, Specialty, SpecialtyCategory, TimeSlot, WorkingSchedule
from apps.users.models import User

pytestmark = pytest.mark.django_db


def _make_doctor(duration=30):
    user = User.objects.create_user(
        email="sched-doc@test.dev", password="Clinic123!", role=RoleChoices.DOCTOR,
        first_name="Sched", last_name="Doc",
    )
    category = SpecialtyCategory.objects.create(name="Sched Category")
    specialty = Specialty.objects.create(name="Sched Specialty", category=category)
    profile = DoctorProfile.objects.create(
        user=user, license_number="LIC-SCHED-1", avg_appointment_duration=duration,
    )
    profile.specialties.add(specialty)
    return profile


def _available_slots(doctor):
    return TimeSlot.objects.filter(doctor=doctor, status=SlotStatus.AVAILABLE).order_by("start_datetime")


def _local_starts(qs):
    return [timezone.localtime(s.start_datetime).strftime("%H:%M") for s in qs]


class TestConsultationDurationDrivesSlots:
    def test_generator_ignores_per_schedule_override(self):
        """Even if a WorkingSchedule row carries a stale slot_duration, the
        generator must strictly follow the doctor's Consultation Duration."""
        doctor = _make_doctor(duration=25)
        today = timezone.localdate()
        WorkingSchedule.objects.create(
            doctor=doctor, weekday=today.weekday(), start_time=time(9, 0), end_time=time(10, 0),
            slot_duration=15, valid_from=today,
        )
        starts = _local_starts(_available_slots(doctor).filter(date=today))
        assert starts == ["09:00", "09:25"]  # 25-min slots in a 9:00-10:00 window

    def test_changing_consultation_duration_resyncs_open_slots(self, api):
        """Editing the doctor's Consultation Duration via the profile endpoint
        must clear stale open slots and regenerate at the new cadence."""
        doctor = _make_doctor(duration=15)
        today = timezone.localdate()
        WorkingSchedule.objects.create(
            doctor=doctor, weekday=today.weekday(), start_time=time(9, 0), end_time=time(10, 0),
            valid_from=today,
        )
        assert _local_starts(_available_slots(doctor).filter(date=today)) == [
            "09:00", "09:15", "09:30", "09:45",
        ]

        api.force_authenticate(doctor.user)
        resp = api.patch(f"/api/doctors/{doctor.pk}/", {"avg_appointment_duration": 30}, format="json")
        assert resp.status_code == 200

        starts = _local_starts(_available_slots(doctor).filter(date=today))
        assert starts == ["09:00", "09:30"]


class TestScheduleEditInvalidatesStaleSlots:
    def test_updating_schedule_clears_old_range_slots(self):
        doctor = _make_doctor(duration=30)
        today = timezone.localdate()
        schedule = WorkingSchedule.objects.create(
            doctor=doctor, weekday=today.weekday(), start_time=time(10, 0), end_time=time(13, 0),
            valid_from=today,
        )
        assert _available_slots(doctor).filter(date=today).count() == 6  # 10:00..12:30 every 30 min

        schedule.start_time = time(9, 0)
        schedule.end_time = time(11, 0)
        schedule.save()

        starts = _local_starts(_available_slots(doctor).filter(date=today))
        assert starts == ["09:00", "09:30", "10:00", "10:30"]
        assert "12:00" not in starts

    def test_deleting_schedule_clears_its_open_slots(self):
        doctor = _make_doctor(duration=30)
        today = timezone.localdate()
        schedule = WorkingSchedule.objects.create(
            doctor=doctor, weekday=today.weekday(), start_time=time(10, 0), end_time=time(13, 0),
            valid_from=today,
        )
        assert _available_slots(doctor).filter(date=today).exists()

        schedule.delete()

        assert not _available_slots(doctor).filter(date=today).exists()

    def test_deleting_schedule_does_not_touch_booked_slots(self):
        doctor = _make_doctor(duration=30)
        today = timezone.localdate()
        schedule = WorkingSchedule.objects.create(
            doctor=doctor, weekday=today.weekday(), start_time=time(10, 0), end_time=time(13, 0),
            valid_from=today,
        )
        booked = _available_slots(doctor).filter(date=today).first()
        booked.status = SlotStatus.BOOKED
        booked.save(update_fields=["status"])

        schedule.delete()

        booked.refresh_from_db()
        assert booked.status == SlotStatus.BOOKED
