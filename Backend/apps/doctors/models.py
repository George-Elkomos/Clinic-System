from pathlib import Path
from uuid import uuid4

from django.conf import settings
from django.db import models

from apps.core.enums import AbsenceType, DoctorPatientSource, SlotStatus, Weekday
from apps.core.models import TimeStampedModel
from apps.users.models import PatientProfile, User


def doctor_photo_path(instance, filename):
    ext = Path(filename).suffix.lower()
    return f"doctor_photos/doctor_{instance.user_id}/{uuid4().hex}{ext}"


class SpecialtyCategory(TimeStampedModel):
    """Coarse grouping (e.g. Cardiovascular). Tags ClinicalNotes so a doctor can
    only edit notes within their own category set."""

    name = models.CharField(max_length=100, unique=True)
    name_ar = models.CharField(max_length=100, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        verbose_name_plural = "specialty categories"
        ordering = ["name"]

    def __str__(self):
        return self.name


class Specialty(TimeStampedModel):
    """e.g. Cardiology, resolving to a SpecialtyCategory."""

    name = models.CharField(max_length=100, unique=True)
    name_ar = models.CharField(max_length=100, blank=True)
    category = models.ForeignKey(
        SpecialtyCategory, on_delete=models.PROTECT, related_name="specialties"
    )
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        verbose_name_plural = "specialties"
        ordering = ["name"]

    def __str__(self):
        return self.name


class DoctorProfile(TimeStampedModel):
    """Extended data for users with role=DOCTOR. Editable by the doctor,
    secretaries, and managers (never patients)."""

    user = models.OneToOneField(
        User, on_delete=models.CASCADE, related_name="doctor_profile"
    )
    specialties = models.ManyToManyField(Specialty, related_name="doctors", blank=True)
    license_number = models.CharField(max_length=64, unique=True)
    bio = models.TextField(blank=True)
    bio_ar = models.TextField(blank=True)
    education = models.TextField(blank=True)
    languages_spoken = models.CharField(max_length=255, blank=True)
    years_experience = models.PositiveIntegerField(default=0)
    # EXTENSION HOOK (payments): used by future billing.
    consultation_fee = models.DecimalField(
        max_digits=8, decimal_places=2, null=True, blank=True
    )
    avg_appointment_duration = models.PositiveIntegerField(
        default=30, help_text="Default slot length in minutes."
    )
    room_number = models.CharField(max_length=32, blank=True)
    photo = models.ImageField(upload_to=doctor_photo_path, null=True, blank=True)
    accepts_walk_ins = models.BooleanField(default=True)
    is_accepting_patients = models.BooleanField(default=True)

    class Meta:
        ordering = ["user__first_name", "user__last_name"]

    def __str__(self):
        return f"Dr. {self.user.get_full_name() or self.user.email}"

    def category_ids(self):
        """SpecialtyCategory ids this doctor may author clinical notes in."""
        return set(
            self.specialties.values_list("category_id", flat=True)
        )


class WorkingSchedule(TimeStampedModel):
    """Recurrence rule for one weekday; the source for slot generation.
    Multiple rows per weekday allow split (AM/PM) shifts."""

    doctor = models.ForeignKey(
        DoctorProfile, on_delete=models.CASCADE, related_name="working_schedules"
    )
    weekday = models.IntegerField(choices=Weekday.choices)
    start_time = models.TimeField()
    end_time = models.TimeField()
    slot_duration = models.PositiveIntegerField(
        null=True, blank=True,
        help_text="Minutes; overrides the doctor's default if set.",
    )
    break_start = models.TimeField(null=True, blank=True)
    break_end = models.TimeField(null=True, blank=True)
    valid_from = models.DateField()
    valid_until = models.DateField(null=True, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["weekday", "start_time"]
        unique_together = [("doctor", "weekday", "start_time", "valid_from")]

    def __str__(self):
        return f"{self.doctor} — {self.get_weekday_display()} {self.start_time}-{self.end_time}"

    @property
    def effective_slot_duration(self):
        return self.slot_duration or self.doctor.avg_appointment_duration


class TimeSlot(models.Model):
    """A concrete bookable window, materialized from a WorkingSchedule.
    Booking flips AVAILABLE->BOOKED under select_for_update; absences flip
    matching rows to BLOCKED (never deleted)."""

    doctor = models.ForeignKey(
        DoctorProfile, on_delete=models.CASCADE, related_name="time_slots"
    )
    date = models.DateField(db_index=True)
    start_datetime = models.DateTimeField()
    end_datetime = models.DateTimeField()
    status = models.CharField(
        max_length=12, choices=SlotStatus.choices, default=SlotStatus.AVAILABLE,
        db_index=True,
    )
    source_schedule = models.ForeignKey(
        WorkingSchedule, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="generated_slots",
    )
    is_walk_in_reserved = models.BooleanField(default=False)

    class Meta:
        ordering = ["start_datetime"]
        # DB guard against duplicate / double slots.
        unique_together = [("doctor", "start_datetime")]
        indexes = [models.Index(fields=["doctor", "date", "status"])]

    def __str__(self):
        return f"{self.doctor} @ {self.start_datetime:%Y-%m-%d %H:%M} ({self.status})"


class DoctorAbsence(TimeStampedModel):
    """Vacation / sick / blocked range. On save, overlapping slots are BLOCKED
    and any booked appointments are cancelled + patients notified (signal)."""

    doctor = models.ForeignKey(
        DoctorProfile, on_delete=models.CASCADE, related_name="absences"
    )
    start_date = models.DateField()
    end_date = models.DateField()
    reason = models.CharField(max_length=255, blank=True)
    absence_type = models.CharField(
        max_length=16, choices=AbsenceType.choices, default=AbsenceType.OTHER
    )
    created_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, related_name="created_absences"
    )
    notify_patients = models.BooleanField(default=True)

    class Meta:
        ordering = ["-start_date"]

    def __str__(self):
        return f"{self.doctor} away {self.start_date}–{self.end_date}"


class DoctorPatient(TimeStampedModel):
    """GLUE MODEL: the 'treated-by' link enforcing 'doctors see only their own
    patients'. Populated when an appointment completes (or a walk-in is recorded)."""

    doctor = models.ForeignKey(
        DoctorProfile, on_delete=models.CASCADE, related_name="doctor_patients"
    )
    patient = models.ForeignKey(
        PatientProfile, on_delete=models.CASCADE, related_name="treating_doctors"
    )
    first_treated_at = models.DateTimeField(auto_now_add=True)
    last_treated_at = models.DateTimeField(null=True, blank=True)
    source = models.CharField(
        max_length=16, choices=DoctorPatientSource.choices,
        default=DoctorPatientSource.APPOINTMENT,
    )

    class Meta:
        unique_together = [("doctor", "patient")]
        ordering = ["-last_treated_at"]

    def __str__(self):
        return f"{self.doctor} ↔ {self.patient}"
