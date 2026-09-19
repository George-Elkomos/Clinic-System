from django.db.models.signals import post_save
from django.dispatch import receiver

from apps.core.enums import RoleChoices

from .models import NotificationPreference, PatientProfile, StaffProfile, User


@receiver(post_save, sender=User)
def create_user_dependents(sender, instance, created, raw, **kwargs):
    """Every user gets notification preferences; patients get a profile;
    secretaries/managers get a staff profile.

    Raw guard is not optional here — it's the difference between a
    fixture/data-migration load (e.g. the SQLite -> PostgreSQL cutover's
    dumpdata/loaddata step) succeeding or crashing outright. NotificationPreference/
    PatientProfile/StaffProfile.user are OneToOneFields (their own auto PK,
    `user_id` UNIQUE) — with no guard, loading a User row auto-creates an
    empty profile via get_or_create(), and the SAME dump's own PatientProfile/
    NotificationPreference row for that user then fails to insert with a
    UNIQUE constraint violation on `user_id`, aborting the entire load.
    """
    if raw:
        return
    if not created:
        return
    NotificationPreference.objects.get_or_create(user=instance)
    if instance.role == RoleChoices.PATIENT:
        PatientProfile.objects.get_or_create(user=instance)
    elif instance.role in (RoleChoices.SECRETARY, RoleChoices.MANAGER):
        StaffProfile.objects.get_or_create(user=instance)
