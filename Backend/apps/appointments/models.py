from django.db import models

from apps.core.enums import (
    AppointmentStatus,
    AppointmentType,
    FollowUpStatus,
    WaitlistStatus,
)
from apps.core.models import TimeStampedModel
from apps.doctors.models import DoctorProfile, TimeSlot
from apps.users.models import PatientProfile, User


class Appointment(TimeStampedModel):
    patient = models.ForeignKey(
        PatientProfile, on_delete=models.CASCADE, related_name="appointments"
    )
    doctor = models.ForeignKey(
        DoctorProfile, on_delete=models.CASCADE, related_name="appointments"
    )
    # Null for pure walk-in / emergency entries with no pre-booked slot.
    time_slot = models.OneToOneField(
        TimeSlot, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="appointment",
    )
    # Denormalized for reporting + queue ordering (survives slot changes).
    scheduled_start = models.DateTimeField()
    scheduled_end = models.DateTimeField()
    status = models.CharField(
        max_length=12, choices=AppointmentStatus.choices,
        default=AppointmentStatus.PENDING, db_index=True,
    )
    appointment_type = models.CharField(
        max_length=12, choices=AppointmentType.choices,
        default=AppointmentType.SCHEDULED,
    )
    # Higher = bumped ahead in the queue (emergencies).
    priority = models.IntegerField(default=0)
    reason = models.TextField(blank=True)
    cancellation_reason = models.TextField(blank=True)
    cancelled_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="cancelled_appointments",
    )
    checked_in_at = models.DateTimeField(null=True, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    # Idempotency flags for the reminder command (Phase 3).
    reminder_24h_sent = models.BooleanField(default=False)
    reminder_1h_sent = models.BooleanField(default=False)
    created_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, related_name="created_appointments"
    )

    class Meta:
        ordering = ["scheduled_start"]
        indexes = [
            models.Index(fields=["doctor", "status", "scheduled_start"]),
            models.Index(fields=["patient", "scheduled_start"]),
        ]

    def __str__(self):
        return f"{self.patient} with {self.doctor} @ {self.scheduled_start:%Y-%m-%d %H:%M}"

    @property
    def is_active(self):
        return self.status in (
            AppointmentStatus.PENDING,
            AppointmentStatus.CONFIRMED,
            AppointmentStatus.CHECKED_IN,
            AppointmentStatus.IN_PROGRESS,
        )


class WaitlistEntry(TimeStampedModel):
    patient = models.ForeignKey(
        PatientProfile, on_delete=models.CASCADE, related_name="waitlist_entries"
    )
    doctor = models.ForeignKey(
        DoctorProfile, on_delete=models.CASCADE, related_name="waitlist_entries"
    )
    desired_date_from = models.DateField()
    desired_date_to = models.DateField()
    status = models.CharField(
        max_length=12, choices=WaitlistStatus.choices, default=WaitlistStatus.WAITING,
        db_index=True,
    )
    notified_at = models.DateTimeField(null=True, blank=True)
    notify_expires_at = models.DateTimeField(null=True, blank=True)
    position = models.IntegerField(default=0)

    class Meta:
        ordering = ["position", "created_at"]

    def __str__(self):
        return f"Waitlist: {self.patient} → {self.doctor} ({self.status})"


class FollowUp(TimeStampedModel):
    origin_appointment = models.ForeignKey(
        Appointment, on_delete=models.CASCADE, related_name="followups"
    )
    patient = models.ForeignKey(
        PatientProfile, on_delete=models.CASCADE, related_name="followups"
    )
    doctor = models.ForeignKey(
        DoctorProfile, on_delete=models.CASCADE, related_name="followups"
    )
    recommended_date = models.DateField()
    suggested_slot = models.ForeignKey(
        TimeSlot, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="suggested_followups",
    )
    resulting_appointment = models.OneToOneField(
        Appointment, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="origin_followup",
    )
    status = models.CharField(
        max_length=12, choices=FollowUpStatus.choices, default=FollowUpStatus.SUGGESTED
    )
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, related_name="created_followups"
    )

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Follow-up for {self.patient} ({self.status})"
