"""Turn appointment status transitions into patient notifications."""
from django.db.models.signals import post_save, pre_save
from django.dispatch import receiver

from apps.core.enums import AppointmentStatus, NotificationVerb

from .models import Appointment


@receiver(pre_save, sender=Appointment)
def capture_old_status(sender, instance, **kwargs):
    if instance.pk:
        old = Appointment.objects.filter(pk=instance.pk).values_list("status", flat=True).first()
        instance._old_status = old
    else:
        instance._old_status = None


@receiver(post_save, sender=Appointment)
def notify_on_status_change(sender, instance, created, **kwargs):
    from apps.notifications.services import notify

    recipient = instance.patient.user
    when = instance.scheduled_start.strftime("%d %b %Y, %H:%M")
    doctor = str(instance.doctor)

    if created:
        notify(
            recipient=recipient,
            verb=NotificationVerb.APPT_BOOKED,
            title="Appointment requested",
            body=f"Your appointment with {doctor} on {when} is awaiting confirmation.",
            related=instance,
        )
        return

    old = getattr(instance, "_old_status", None)
    if old == instance.status:
        return

    if instance.status == AppointmentStatus.CONFIRMED:
        notify(
            recipient=recipient,
            verb=NotificationVerb.APPT_CONFIRMED,
            title="Appointment confirmed",
            body=f"Your appointment with {doctor} on {when} is confirmed.",
            related=instance,
        )
    elif instance.status == AppointmentStatus.CANCELLED:
        # Absence cancellations send their own ABSENCE notification instead.
        if getattr(instance, "_skip_cancel_notification", False):
            return
        reason = f" Reason: {instance.cancellation_reason}" if instance.cancellation_reason else ""
        notify(
            recipient=recipient,
            verb=NotificationVerb.APPT_CANCELLED,
            title="Appointment cancelled",
            body=f"Your appointment with {doctor} on {when} was cancelled.{reason}",
            related=instance,
        )
    elif instance.status == AppointmentStatus.COMPLETED:
        notify(
            recipient=recipient,
            verb=NotificationVerb.REVIEW,
            title="How was your visit?",
            body=f"Your visit with {doctor} is complete. We'd love your feedback — please leave a review.",
            related=instance,
        )
