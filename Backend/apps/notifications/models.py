from django.db import models

from apps.core.enums import NotificationVerb
from apps.core.models import TimeStampedModel
from apps.users.models import User


class Notification(TimeStampedModel):
    """In-app notification (the bell). Email/SMS delivery is recorded in
    `channels_sent`; the row itself is the in-app channel."""

    recipient = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="notifications"
    )
    verb = models.CharField(
        max_length=24, choices=NotificationVerb.choices, default=NotificationVerb.GENERIC
    )
    title = models.CharField(max_length=200)
    title_ar = models.CharField(max_length=200, blank=True)
    body = models.TextField(blank=True)
    body_ar = models.TextField(blank=True)
    channels_sent = models.JSONField(default=list, blank=True)
    is_read = models.BooleanField(default=False, db_index=True)
    read_at = models.DateTimeField(null=True, blank=True)
    # Generic deep-link target (avoids hard FK so it survives related deletes).
    related_object_type = models.CharField(max_length=64, blank=True)
    related_object_id = models.BigIntegerField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["recipient", "is_read"])]

    def __str__(self):
        return f"[{self.verb}] {self.title} → {self.recipient.email}"
