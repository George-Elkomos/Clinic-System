"""Materialize bookable TimeSlots from WorkingSchedule recurrence rules.

Idempotent: keyed on (doctor, start_datetime) via get_or_create, so re-running
never duplicates and never disturbs already-BOOKED slots.
"""
from datetime import datetime, timedelta

from django.conf import settings
from django.db.models import Q
from django.utils import timezone

from apps.core.enums import SlotStatus

from ..models import DoctorProfile, TimeSlot, WorkingSchedule


def _overlaps_break(slot_start, slot_end, break_start, break_end):
    if not (break_start and break_end):
        return False
    return slot_start < break_end and slot_end > break_start


def generate_slots_for_doctor(doctor, start_date, end_date):
    """Create AVAILABLE slots for `doctor` across [start_date, end_date]."""
    tz = timezone.get_current_timezone()
    created = 0
    day = start_date
    while day <= end_date:
        schedules = WorkingSchedule.objects.filter(
            doctor=doctor, is_active=True, weekday=day.weekday(), valid_from__lte=day
        ).filter(Q(valid_until__isnull=True) | Q(valid_until__gte=day))

        for schedule in schedules:
            duration = timedelta(minutes=schedule.effective_slot_duration)
            cursor = datetime.combine(day, schedule.start_time)
            day_end = datetime.combine(day, schedule.end_time)
            while cursor + duration <= day_end:
                slot_end = cursor + duration
                if not _overlaps_break(
                    cursor.time(), slot_end.time(),
                    schedule.break_start, schedule.break_end,
                ):
                    start_dt = timezone.make_aware(cursor, tz)
                    _, was_created = TimeSlot.objects.get_or_create(
                        doctor=doctor,
                        start_datetime=start_dt,
                        defaults={
                            "date": day,
                            "end_datetime": timezone.make_aware(slot_end, tz),
                            "status": SlotStatus.AVAILABLE,
                            "source_schedule": schedule,
                        },
                    )
                    created += int(was_created)
                cursor = slot_end
        day += timedelta(days=1)
    return created


def mark_past_slots(doctor=None):
    """Flip elapsed AVAILABLE slots to PAST so they drop out of availability."""
    qs = TimeSlot.objects.filter(
        status=SlotStatus.AVAILABLE, start_datetime__lt=timezone.now()
    )
    if doctor is not None:
        qs = qs.filter(doctor=doctor)
    return qs.update(status=SlotStatus.PAST)


def generate_all(start_date=None, end_date=None, horizon_days=None):
    """Top up slots for every active doctor across the rolling horizon."""
    today = timezone.localdate()
    start_date = start_date or today
    horizon = horizon_days or settings.SLOT_HORIZON_DAYS
    end_date = end_date or (today + timedelta(days=horizon))

    total = 0
    for doctor in DoctorProfile.objects.all():
        total += generate_slots_for_doctor(doctor, start_date, end_date)
        mark_past_slots(doctor)
    return total
