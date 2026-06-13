"""Abstract base models reused across apps."""
from django.db import models
from django.utils import timezone


class TimeStampedModel(models.Model):
    """Adds created/updated timestamps to any model."""

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class ActiveManager(models.Manager):
    """Default manager that hides soft-deleted rows."""

    def get_queryset(self):
        return super().get_queryset().filter(is_deleted=False)


class SoftDeleteModel(models.Model):
    """Append-only friendly base: rows are flagged, never hard-deleted.

    `objects` hides soft-deleted rows; `all_objects` sees everything (used by
    managers/audit so history is never truly lost).
    """

    is_deleted = models.BooleanField(default=False, db_index=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    objects = ActiveManager()
    all_objects = models.Manager()

    class Meta:
        abstract = True

    def soft_delete(self):
        self.is_deleted = True
        self.deleted_at = timezone.now()
        self.save(update_fields=["is_deleted", "deleted_at", "updated_at"])
