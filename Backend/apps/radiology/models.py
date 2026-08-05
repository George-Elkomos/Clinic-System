"""Radiology order templates + structured orders (Phase 15).

RadiologyTemplate is the master catalog (Chest X-Ray, Abdominal Ultrasound,
...). RadiologyOrder is the per-patient order created from a template (or
free-text study_name) and carries its own denormalized copy of the study name
so edits to the master template never retroactively change a patient's
historical order — same trick as apps.procedures.ClinicalProcedure.
"""
from django.db import models, transaction
from django.utils import timezone

from apps.core.enums import RadiologyModality, RadiologyOrderPriority, RadiologyOrderStatus
from apps.core.models import SoftDeleteModel, TimeStampedModel
from apps.doctors.models import DoctorProfile
from apps.users.models import PatientProfile


class RadiologyTemplate(TimeStampedModel):
    name = models.CharField(max_length=200)
    name_ar = models.CharField(max_length=200, blank=True)
    modality = models.CharField(
        max_length=12, choices=RadiologyModality.choices, default=RadiologyModality.OTHER
    )
    body_part = models.CharField(max_length=200, blank=True)
    instructions = models.TextField(blank=True)  # patient prep, e.g. "fast 8 hours"
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


def _generate_accession_number():
    year = timezone.now().year
    prefix = f"RAD-{year}-"
    with transaction.atomic():
        # select_for_update serialises concurrent writers so two requests
        # cannot both read the same last sequence number before either inserts.
        last = (
            RadiologyOrder.all_objects.select_for_update()
            .filter(accession_number__startswith=prefix)
            .order_by("-created_at")
            .values_list("accession_number", flat=True)
            .first()
        )
        seq = int(last.split("-")[-1]) + 1 if last else 1
        return f"{prefix}{seq:04d}"


class RadiologyOrder(SoftDeleteModel, TimeStampedModel):
    accession_number = models.CharField(max_length=20, unique=True, editable=False)
    patient = models.ForeignKey(PatientProfile, on_delete=models.CASCADE, related_name="radiology_orders")
    doctor = models.ForeignKey(DoctorProfile, on_delete=models.PROTECT, related_name="radiology_orders")
    appointment = models.ForeignKey(
        "appointments.Appointment", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="radiology_orders",
    )
    encounter = models.ForeignKey(
        "encounters.Encounter", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="radiology_orders",
    )
    template = models.ForeignKey(
        RadiologyTemplate, on_delete=models.SET_NULL, null=True, blank=True, related_name="orders"
    )

    study_name = models.CharField(max_length=255, blank=True)
    study_name_ar = models.CharField(max_length=255, blank=True)
    clinical_reason = models.TextField(blank=True)

    priority = models.CharField(
        max_length=10, choices=RadiologyOrderPriority.choices, default=RadiologyOrderPriority.ROUTINE
    )
    status = models.CharField(
        max_length=12, choices=RadiologyOrderStatus.choices, default=RadiologyOrderStatus.ORDERED, db_index=True
    )

    findings = models.TextField(blank=True)
    impression = models.TextField(blank=True)

    completed_at = models.DateTimeField(null=True, blank=True)
    reported_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancellation_reason = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["patient", "status"]),
            models.Index(fields=["doctor", "status"]),
            models.Index(fields=["status", "created_at"]),
        ]

    def save(self, *args, **kwargs):
        if not self.accession_number:
            self.accession_number = _generate_accession_number()
        if self.template_id and not self.study_name:
            self.study_name = self.template.name
            self.study_name_ar = self.template.name_ar
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.accession_number} ({self.status})"
