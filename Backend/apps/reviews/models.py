"""Doctor reviews (module 10). Full API/UI is Phase 4; the model exists now so
the public doctor directory can already show aggregate ratings.

Visibility rules (enforced in Phase 4 serializers/permissions):
- Public: aggregate rating + count only (NO comments).
- Doctor: read own reviews (read-only).
- Secretary: must NOT see comments.
- Manager: sees all + can hide/flag.
"""
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from apps.core.models import TimeStampedModel
from apps.doctors.models import DoctorProfile
from apps.users.models import PatientProfile, User


class Review(TimeStampedModel):
    patient = models.ForeignKey(PatientProfile, on_delete=models.CASCADE, related_name="reviews")
    doctor = models.ForeignKey(DoctorProfile, on_delete=models.CASCADE, related_name="reviews")
    appointment = models.ForeignKey(
        "appointments.Appointment", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="reviews",
    )
    rating = models.PositiveSmallIntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(5)]
    )
    comment = models.TextField(blank=True)
    is_hidden = models.BooleanField(default=False)
    hidden_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True, related_name="hidden_reviews"
    )
    hidden_reason = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ["-created_at"]
        # One review per visit (anti-spam).
        unique_together = [("patient", "appointment")]

    def __str__(self):
        return f"{self.rating}★ for {self.doctor} by {self.patient}"
