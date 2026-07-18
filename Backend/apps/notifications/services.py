"""Single entry point for raising notifications. Domain signals call notify();
it creates the in-app row immediately and queues external delivery (email/SMS/
WhatsApp) on the Django-Q worker, so a slow SMTP relay or Twilio API never
blocks the request that triggered the notification (booking, cancelling, etc.)."""
from datetime import timedelta

from django.conf import settings
from django.utils import timezone
from django_q.tasks import async_task

from . import backends
from .models import Notification


def _wants(channels, channel):
    """If the caller didn't restrict channels, every channel is eligible."""
    return channels is None or channel in channels


def notify(*, recipient, verb, title, body="", title_ar="", body_ar="",
           related=None, channels=None):
    """Create the in-app notification now; queue external channels for the worker.

    `channels` optionally restricts delivery (e.g. ["in_app"]); by default all
    channels the recipient has enabled are used. `related` is any model instance
    used to build a deep-link.
    """
    related_type = related.__class__.__name__ if related is not None else ""
    related_id = getattr(related, "pk", None) if related is not None else None

    notification = Notification.objects.create(
        recipient=recipient,
        verb=verb,
        title=title,
        title_ar=title_ar,
        body=body,
        body_ar=body_ar,
        related_object_type=related_type,
        related_object_id=related_id,
    )

    prefs = getattr(recipient, "notification_preference", None)
    sent = []
    if (prefs is None or prefs.in_app_enabled) and _wants(channels, "in_app"):
        sent.append("in_app")

    external = []
    if (prefs is None or prefs.email_enabled) and _wants(channels, "email"):
        external.append("email")
    if (prefs is None or prefs.sms_enabled) and _wants(channels, "sms"):
        external.append("sms")
    if prefs is not None and prefs.whatsapp_enabled and _wants(channels, "whatsapp"):
        external.append("whatsapp")

    notification.channels_sent = sent
    notification.save(update_fields=["channels_sent"])

    if external:
        async_task(deliver_external_channels, notification.pk, external)
    return notification


def deliver_external_channels(notification_id, channels):
    """Worker task: send the slow/networked channels, then record what landed.

    Runs off the request thread (see Q_CLUSTER in settings/base.py). Re-fetches
    the notification since this executes in a separate worker process/thread.
    """
    try:
        notification = Notification.objects.get(pk=notification_id)
    except Notification.DoesNotExist:
        return

    sent = list(notification.channels_sent)
    if "email" in channels and backends.send_email(notification):
        sent.append("email")
    if "sms" in channels and backends.send_sms(notification):
        sent.append("sms")
    if "whatsapp" in channels and backends.send_whatsapp(notification):
        sent.append("whatsapp")

    notification.channels_sent = sent
    notification.save(update_fields=["channels_sent"])


def _reminder_window(now, hours, window_min, flag_field, pref_field):
    """Process CONFIRMED appointments whose start falls in a reminder window.
    Idempotent: each appointment is flagged once it's been considered."""
    from apps.appointments.models import Appointment
    from apps.core.enums import AppointmentStatus, NotificationVerb

    center = now + timedelta(hours=hours)
    lo = center - timedelta(minutes=window_min)
    hi = center + timedelta(minutes=window_min)
    qs = Appointment.objects.select_related("patient__user", "doctor__user").filter(
        status=AppointmentStatus.CONFIRMED,
        scheduled_start__gte=lo,
        scheduled_start__lte=hi,
        **{flag_field: False},
    )
    when_label = "tomorrow" if hours >= 24 else "in 1 hour"
    sent = 0
    for appt in qs:
        recipient = appt.patient.user
        prefs = getattr(recipient, "notification_preference", None)
        wants = prefs is None or getattr(prefs, pref_field, True)
        if wants:
            when = appt.scheduled_start.strftime("%d %b %Y, %H:%M")
            notify(
                recipient=recipient,
                verb=NotificationVerb.APPT_REMINDER,
                title=f"Appointment reminder ({when_label})",
                body=f"Reminder: your appointment with {appt.doctor} is on {when}.",
                related=appt,
            )
            sent += 1
        setattr(appt, flag_field, True)
        appt.save(update_fields=[flag_field, "updated_at"])
    return sent


def send_due_reminders(now=None):
    """Send 24h + 1h reminders for upcoming confirmed appointments."""
    now = now or timezone.now()
    return {
        "reminders_24h": _reminder_window(
            now, 24, settings.REMINDER_24H_WINDOW_MINUTES, "reminder_24h_sent", "reminder_24h"
        ),
        "reminders_1h": _reminder_window(
            now, 1, settings.REMINDER_1H_WINDOW_MINUTES, "reminder_1h_sent", "reminder_1h"
        ),
    }


def expire_due_waitlist(now=None):
    """Expire waitlist holds whose notify window has passed."""
    from apps.appointments.models import WaitlistEntry
    from apps.core.enums import WaitlistStatus

    now = now or timezone.now()
    return WaitlistEntry.objects.filter(
        status=WaitlistStatus.NOTIFIED, notify_expires_at__lt=now
    ).update(status=WaitlistStatus.EXPIRED)
