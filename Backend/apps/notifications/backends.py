"""Pluggable delivery backends. Email is always available (console in dev);
SMS is optional and no-ops unless enabled + configured. New channels
(push, WhatsApp, in-app web-push) can be added here without touching callers."""
import logging

from django.conf import settings
from django.core.mail import send_mail

logger = logging.getLogger(__name__)


def _e164(phone: str) -> str:
    """Normalize a phone number to E.164. Defaults to Egypt (+20) when no
    country code is present.

    Examples (all → +201090844446):
      +20 10 90844446   01090844446   1090844446   00201090844446
    """
    # Strip all non-digit characters except leading +
    digits = ''.join(c for c in phone if c.isdigit() or c == '+')
    digits = digits.strip()
    if digits.startswith('+'):
        return digits                       # already E.164
    if digits.startswith('00'):
        return '+' + digits[2:]            # IDD prefix 00XX → +XX
    if digits.startswith('0'):
        return '+20' + digits[1:]          # local 0xx... → +20xx...
    if digits.startswith('20'):
        return '+' + digits                # missing leading +
    return '+20' + digits                  # bare number → assume Egypt


def _localized_text(notification):
    """Pick the recipient's preferred-language title/body, falling back to
    English when no Arabic translation was recorded for this notification."""
    if notification.recipient.preferred_language == "ar" and notification.title_ar:
        return notification.title_ar, notification.body_ar or notification.body
    return notification.title, notification.body


def send_email(notification):
    recipient = notification.recipient
    if not recipient.email:
        return False
    title, body = _localized_text(notification)
    send_mail(
        subject=title,
        message=body,
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[recipient.email],
        fail_silently=True,
    )
    return True


def _twilio_client():
    """Build a Twilio REST client.

    Supports two auth styles:
    - API Key (preferred): set TWILIO_API_KEY (SK...) + TWILIO_AUTH_TOKEN (secret)
    - Auth Token (legacy): set TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN (hex token)
    """
    from twilio.rest import Client

    if settings.TWILIO_API_KEY:
        return Client(settings.TWILIO_API_KEY, settings.TWILIO_AUTH_TOKEN,
                      account_sid=settings.TWILIO_ACCOUNT_SID)
    return Client(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)


def send_sms(notification):
    """No-op unless SMS_ENABLED and Twilio credentials are present."""
    if not settings.SMS_ENABLED:
        return False
    phone = notification.recipient.phone
    if not (phone and settings.TWILIO_ACCOUNT_SID and settings.TWILIO_AUTH_TOKEN):
        return False
    try:  # imported lazily so Twilio is not a hard dependency
        title, body = _localized_text(notification)
        client = _twilio_client()
        client.messages.create(
            body=f"{title}: {body}",
            from_=settings.TWILIO_FROM_NUMBER,
            to=_e164(phone),
        )
        return True
    except Exception:  # pragma: no cover - depends on external service
        logger.exception("Failed to send SMS notification %s", notification.pk)
        return False


def send_whatsapp(notification):
    """No-op unless WHATSAPP_ENABLED and an OpenWA session is configured.

    Sends through a self-hosted OpenWA gateway (unofficial WhatsApp client —
    see OPENWA_* settings) rather than Twilio's WhatsApp API. The session
    referenced by OPENWA_SESSION_ID must already be paired (QR-scanned)
    against a dedicated clinic number before this can succeed.
    """
    if not settings.WHATSAPP_ENABLED:
        return False
    phone = notification.recipient.phone
    if not (phone and settings.OPENWA_API_KEY and settings.OPENWA_SESSION_ID):
        return False
    try:
        import requests

        title, body = _localized_text(notification)
        chat_id = f"{_e164(phone).lstrip('+')}@c.us"
        response = requests.post(
            f"{settings.OPENWA_BASE_URL}/api/sessions/{settings.OPENWA_SESSION_ID}/messages/send-text",
            json={"chatId": chat_id, "text": f"*{title}*\n{body}"},
            headers={"X-API-Key": settings.OPENWA_API_KEY},
            timeout=10,
        )
        response.raise_for_status()
        return True
    except Exception:  # pragma: no cover - depends on external service
        logger.exception("Failed to send WhatsApp notification %s", notification.pk)
        return False
