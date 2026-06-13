from django.contrib.auth.models import AbstractUser
from django.db import models
from django.utils.translation import gettext_lazy as _

from apps.core.enums import BloodType, GenderChoices, LanguageChoices, RoleChoices
from apps.core.models import TimeStampedModel

from .managers import UserManager


class User(AbstractUser):
    """Custom user — email login + a single source-of-truth `role`."""

    username = None  # email replaces username
    email = models.EmailField(_("email address"), unique=True)
    role = models.CharField(max_length=20, choices=RoleChoices.choices, db_index=True)
    phone = models.CharField(max_length=32, blank=True)
    preferred_language = models.CharField(
        max_length=5, choices=LanguageChoices.choices, default=LanguageChoices.EN
    )

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = []  # email + password are prompted automatically

    objects = UserManager()

    class Meta:
        ordering = ["first_name", "last_name"]

    def __str__(self):
        return f"{self.get_full_name() or self.email} ({self.role})"

    @property
    def is_patient(self):
        return self.role == RoleChoices.PATIENT

    @property
    def is_doctor(self):
        return self.role == RoleChoices.DOCTOR

    @property
    def is_secretary(self):
        return self.role == RoleChoices.SECRETARY

    @property
    def is_manager(self):
        return self.role == RoleChoices.MANAGER


class NotificationPreference(TimeStampedModel):
    """Per-user channel + reminder opt-ins. Auto-created via signal."""

    user = models.OneToOneField(
        User, on_delete=models.CASCADE, related_name="notification_preference"
    )
    email_enabled = models.BooleanField(default=True)
    sms_enabled = models.BooleanField(default=False)
    whatsapp_enabled = models.BooleanField(default=False)
    in_app_enabled = models.BooleanField(default=True)
    reminder_24h = models.BooleanField(default=True)
    reminder_1h = models.BooleanField(default=True)
    quiet_hours_start = models.TimeField(null=True, blank=True)
    quiet_hours_end = models.TimeField(null=True, blank=True)

    def __str__(self):
        return f"Preferences for {self.user.email}"


class PatientProfile(TimeStampedModel):
    """Extended data for users with role=PATIENT."""

    user = models.OneToOneField(
        User, on_delete=models.CASCADE, related_name="patient_profile"
    )
    national_id = models.CharField(max_length=64, unique=True, null=True, blank=True)
    date_of_birth = models.DateField(null=True, blank=True)
    gender = models.CharField(max_length=12, choices=GenderChoices.choices, blank=True)
    blood_type = models.CharField(max_length=3, choices=BloodType.choices, blank=True)
    address = models.TextField(blank=True)
    emergency_contact_name = models.CharField(max_length=150, blank=True)
    emergency_contact_phone = models.CharField(max_length=32, blank=True)
    # Quick-reference; full structured detail lives in MedicalRecord.
    allergies_summary = models.TextField(blank=True)
    # Patient-entered medical background (module 6).
    chronic_conditions = models.TextField(blank=True)
    previous_surgeries = models.TextField(blank=True)
    current_medications = models.TextField(blank=True)

    def __str__(self):
        return f"Patient: {self.user.get_full_name() or self.user.email}"
