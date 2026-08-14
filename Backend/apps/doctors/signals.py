"""When a DoctorAbsence is recorded, block matching slots (never delete) and
cancel any booked appointments so affected patients get notified."""
from django.db import transaction
from django.db.models.signals import post_save, pre_delete
from django.dispatch import receiver

from apps.core.enums import AppointmentStatus, SlotStatus

from .models import DoctorAbsence, TimeSlot, WorkingSchedule


@receiver(post_save, sender=DoctorAbsence)
def block_slots_for_absence(sender, instance, created, **kwargs):
    if not created:
        return

    with transaction.atomic():
        slots = (
            TimeSlot.objects.select_for_update()
            .filter(
                doctor=instance.doctor,
                date__gte=instance.start_date,
                date__lte=instance.end_date,
            )
            .exclude(status=SlotStatus.PAST)
        )
        for slot in slots:
            if slot.status == SlotStatus.BOOKED:
                appt = getattr(slot, "appointment", None)
                if appt and appt.status in (
                    AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED
                ):
                    appt.status = AppointmentStatus.CANCELLED
                    appt.cancellation_reason = (
                        instance.reason or "Doctor is unavailable on this date."
                    )
                    appt.cancelled_by = instance.created_by
                    # Send a dedicated ABSENCE notification instead of the generic
                    # cancellation one (flag read by the appointment signal).
                    appt._skip_cancel_notification = True
                    appt.save(update_fields=[
                        "status", "cancellation_reason", "cancelled_by", "updated_at",
                    ])
                    if instance.notify_patients:
                        _notify_absence(appt)
            slot.status = SlotStatus.BLOCKED
            slot.save(update_fields=["status"])


def _notify_absence(appt):
    from apps.core.enums import NotificationVerb
    from apps.notifications.services import notify

    when = appt.scheduled_start.strftime("%d %b %Y, %H:%M")
    notify(
        recipient=appt.patient.user,
        verb=NotificationVerb.ABSENCE,
        title="Appointment cancelled — doctor unavailable",
        body=(
            f"Your appointment with {appt.doctor} on {when} was cancelled because "
            f"the doctor is unavailable. Please rebook at a time that suits you."
        ),
        related=appt,
    )


@receiver(post_save, sender=WorkingSchedule)
def generate_slots_for_new_schedule(sender, instance, **kwargs):
    """When a working day is added or edited, first retract any still-open
    slots this rule previously generated — its old start/end/break/duration
    may no longer apply — then re-materialize across the horizon so what's
    bookable always matches the rule currently in force (idempotent)."""
    from .services import slot_generator

    with transaction.atomic():
        slot_generator.clear_unbooked_slots(source_schedule=instance)

        if not instance.is_active:
            return

        from datetime import timedelta

        from django.conf import settings
        from django.utils import timezone

        start = max(instance.valid_from, timezone.localdate())
        end = instance.valid_until or (timezone.localdate() + timedelta(days=settings.SLOT_HORIZON_DAYS))
        slot_generator.generate_slots_for_doctor(instance.doctor, start, end)


@receiver(pre_delete, sender=WorkingSchedule)
def clear_slots_for_deleted_schedule(sender, instance, **kwargs):
    """Deleting a working day should retract its still-open slots immediately
    instead of leaving stale AVAILABLE rows visible to patients until the
    next generate_all sweep."""
    from .services import slot_generator

    slot_generator.clear_unbooked_slots(source_schedule=instance)
