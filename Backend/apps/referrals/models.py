"""Patient referrals (Phase 13).

A doctor refers a patient out of an in-progress Encounter — internally to a
specialty (optionally to a specific doctor in it), or externally to an outside
facility named as free text. Internal referrals carry a PENDING -> ACCEPTED ->
COMPLETED lifecycle (or CANCELLED at any point before COMPLETED); see
services.py for the transitions.
"""
from django.db import models
from django.utils import timezone

from apps.core.enums import ReferralStatus, ReferralType
from apps.core.models import TimeStampedModel
from apps.doctors.models import DoctorProfile, Specialty
from apps.encounters.models import Encounter
from apps.users.models import PatientProfile


class Referral(TimeStampedModel):
    patient = models.ForeignKey(
        PatientProfile, on_delete=models.CASCADE, related_name="referrals"
    )
    referring_doctor = models.ForeignKey(
        DoctorProfile, on_delete=models.SET_NULL, null=True, related_name="referrals_made"
    )
    encounter = models.ForeignKey(
        Encounter, on_delete=models.CASCADE, related_name="referrals"
    )

    referral_type = models.CharField(
        max_length=8, choices=ReferralType.choices, default=ReferralType.INTERNAL
    )
    specialty = models.ForeignKey(
        Specialty, on_delete=models.SET_NULL, null=True, blank=True, related_name="referrals"
    )
    target_doctor = models.ForeignKey(
        DoctorProfile, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="referrals_received",
    )
    external_facility_name = models.CharField(max_length=200, blank=True)
    accepted_by = models.ForeignKey(
        DoctorProfile, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="referrals_accepted",
    )

    reason = models.TextField()
    reason_ar = models.TextField(blank=True)
    notes = models.TextField(blank=True)
    notes_ar = models.TextField(blank=True)

    referral_date = models.DateField(default=timezone.localdate)
    status = models.CharField(
        max_length=10, choices=ReferralStatus.choices,
        default=ReferralStatus.PENDING, db_index=True,
    )

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["patient", "status"]),
            models.Index(fields=["referring_doctor", "status"]),
        ]

    def __str__(self):
        target = self.target_doctor or self.specialty or self.external_facility_name
        return f"Referral #{self.pk}: {self.patient} -> {target} ({self.status})"
