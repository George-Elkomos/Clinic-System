"""Turn appointment status transitions into patient notifications, and push a
live-queue refresh signal to the owning doctor's WebSocket group."""
import logging

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db.models.signals import post_save, pre_save
from django.dispatch import receiver

from apps.core.enums import AppointmentStatus, NotificationVerb

from .models import Appointment

logger = logging.getLogger(__name__)


@receiver(pre_save, sender=Appointment)
def capture_old_status(sender, instance, **kwargs):
    if instance.pk:
        old = Appointment.objects.filter(pk=instance.pk).values_list("status", flat=True).first()
        instance._old_status = old
    else:
        instance._old_status = None


@receiver(post_save, sender=Appointment)
def broadcast_queue_update(sender, instance, **kwargs):
    """Wake up the doctor's live queue page (DoctorQueuePage) via WebSocket.

    Unconditional on every save — not just status changes — because a
    priority-only update (mark-emergency) can reorder "next" without changing
    status, and correctness here matters more than shaving a few pushes.
    The socket carries no payload; the client just re-fetches GET my-queue/,
    so a redundant push is harmless, unlike a missed one.

    Never let a real-time hiccup break the appointment save itself.
    """
    from .consumers import group_for_doctor

    try:
        layer = get_channel_layer()
        if layer is None:
            return
        async_to_sync(layer.group_send)(
            group_for_doctor(instance.doctor_id), {"type": "queue.update"}
        )
    except Exception:  # noqa: BLE001 - real-time push is best-effort
        logger.exception("Failed to broadcast queue update for doctor %s", instance.doctor_id)


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
