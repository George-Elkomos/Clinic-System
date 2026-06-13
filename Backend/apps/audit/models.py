from django.db import models

from apps.core.enums import AuditAction
from apps.users.models import User


class AuditLog(models.Model):
    """Single, manager-facing change ledger: who / what / old-value / when.

    Generic (not FK) object references so rows survive deletion of the target.
    Also captures non-model events (LOGIN/LOGOUT)."""

    actor = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True, related_name="audit_logs"
    )
    action = models.CharField(max_length=12, choices=AuditAction.choices, db_index=True)
    model_name = models.CharField(max_length=64, blank=True, db_index=True)
    object_id = models.CharField(max_length=64, blank=True)
    object_repr = models.CharField(max_length=200, blank=True)
    # {field: {"old": ..., "new": ...}} — satisfies the who/what/OLD-VALUE requirement.
    changes = models.JSONField(default=dict, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=512, blank=True)
    timestamp = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-timestamp"]
        indexes = [models.Index(fields=["model_name", "action", "timestamp"])]

    def __str__(self):
        who = self.actor.email if self.actor else "system"
        return f"{who} {self.action} {self.model_name}#{self.object_id} @ {self.timestamp:%Y-%m-%d %H:%M}"
