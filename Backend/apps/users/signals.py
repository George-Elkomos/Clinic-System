from django.db.models.signals import post_save
from django.dispatch import receiver

from apps.core.enums import RoleChoices

from .models import NotificationPreference, PatientProfile, StaffProfile, User


@receiver(post_save, sender=User)
def create_user_dependents(sender, instance, created, **kwargs):
    """Every user gets notification preferences; patients get a profile;
    secretaries/managers get a staff profile."""
    if not created:
        return
    NotificationPreference.objects.get_or_create(user=instance)
    if instance.role == RoleChoices.PATIENT:
        PatientProfile.objects.get_or_create(user=instance)
    elif instance.role in (RoleChoices.SECRETARY, RoleChoices.MANAGER):
        StaffProfile.objects.get_or_create(user=instance)
