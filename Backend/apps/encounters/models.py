"""Structured clinical encounter (Phase 8).

An Encounter is the structured record a doctor fills during an in-progress
appointment: chief complaint, symptoms, examination findings, diagnosis and
treatment — all bilingual. Submitting it completes the appointment and mirrors
the core fields into an append-only MedicalRecord version (see services.py).

Versioning mirrors MedicalRecord: an amendment never mutates a submitted row in
place — it marks the original AMENDED/not-current and creates an editable DRAFT
twin that `supersedes` it.
"""
from django.db import models
from django.utils import timezone

from apps.core.models import SoftDeleteModel, TimeStampedModel
from apps.doctors.models import DoctorProfile
from apps.users.models import PatientProfile


class ComplaintCategory(models.TextChoices):
    CARDIAC = "CARDIAC", "Cardiac"
    RESPIRATORY = "RESPIRATORY", "Respiratory"
    GI = "GI", "Gastrointestinal"
    MUSCULOSKELETAL = "MUSCULOSKELETAL", "Musculoskeletal"
    NEUROLOGICAL = "NEUROLOGICAL", "Neurological"
    OTHER = "OTHER", "Other"


class EncounterStatus(models.TextChoices):
    DRAFT = "DRAFT", "Draft"
    SUBMITTED = "SUBMITTED", "Submitted"
    AMENDED = "AMENDED", "Amended"


class Complaint(TimeStampedModel):
    """Master lookup feeding the chief-complaint combobox + symptoms checklist."""

    name = models.CharField(max_length=200)
    name_ar = models.CharField(max_length=200, blank=True)
    category = models.CharField(
        max_length=20, choices=ComplaintCategory.choices, default=ComplaintCategory.OTHER
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class Diagnosis(TimeStampedModel):
    """Master lookup feeding the diagnosis combobox."""

    name = models.CharField(max_length=200)
    name_ar = models.CharField(max_length=200, blank=True)
    category = models.CharField(
        max_length=20, choices=ComplaintCategory.choices, default=ComplaintCategory.OTHER
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]
        verbose_name_plural = "diagnoses"

    def __str__(self):
        return self.name


class Encounter(SoftDeleteModel, TimeStampedModel):
    patient = models.ForeignKey(
        PatientProfile, on_delete=models.CASCADE, related_name="encounters"
    )
    doctor = models.ForeignKey(
        DoctorProfile, on_delete=models.SET_NULL, null=True, related_name="doctor_encounters"
    )
    appointment = models.OneToOneField(
        "appointments.Appointment", on_delete=models.SET_NULL,
        null=True, blank=True, related_name="encounter",
    )
    encounter_date = models.DateField(default=timezone.localdate)
    status = models.CharField(
        max_length=12, choices=EncounterStatus.choices,
        default=EncounterStatus.DRAFT, db_index=True,
    )

    # Clinical inputs (bilingual).
    chief_complaint = models.CharField(max_length=255, blank=True)
    chief_complaint_ar = models.CharField(max_length=255, blank=True)
    symptoms = models.JSONField(default=list, blank=True)
    examination_findings = models.TextField(blank=True)
    examination_findings_ar = models.TextField(blank=True)
    diagnosis = models.ForeignKey(
        Diagnosis, on_delete=models.SET_NULL, null=True, blank=True, related_name="encounters"
    )
    diagnosis_notes = models.TextField(blank=True)
    treatment_plan = models.TextField(blank=True)
    treatment_plan_ar = models.TextField(blank=True)
    vitals = models.ForeignKey(
        "vital_signs.VitalSigns", on_delete=models.SET_NULL,
        null=True, blank=True, related_name="encounters",
    )

    # Versioning / audit.
    version = models.PositiveIntegerField(default=1)
    is_current = models.BooleanField(default=True)
    supersedes = models.ForeignKey(
        "self", on_delete=models.SET_NULL, null=True, blank=True, related_name="amended_by"
    )

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["patient", "is_current"]),
            models.Index(fields=["doctor", "status"]),
        ]

    def __str__(self):
        return f"Encounter #{self.pk} for {self.patient} ({self.status})"
