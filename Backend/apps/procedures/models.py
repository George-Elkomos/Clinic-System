"""Clinical procedures (Phase 14).

ProcedureTemplate is the master catalog (suturing, injections, dressing
changes, biopsies, ...) with a JSON checklist template. ClinicalProcedure is
the per-patient record created from a template (or free-text) and carries its
own copy of the checklist so edits to the master template never retroactively
change a patient's historical record.
"""
from django.db import models

from apps.core.enums import ProcedureCategory, ProcedureStatus
from apps.core.models import SoftDeleteModel, TimeStampedModel
from apps.doctors.models import DoctorProfile
from apps.users.models import PatientProfile


class ProcedureTemplate(TimeStampedModel):
    name = models.CharField(max_length=200)
    name_ar = models.CharField(max_length=200, blank=True)
    category = models.CharField(
        max_length=20, choices=ProcedureCategory.choices, default=ProcedureCategory.OTHER
    )
    description = models.TextField(blank=True)
    estimated_duration_minutes = models.PositiveIntegerField(default=15)
    # [{"step": str, "required": bool}, ...]
    checklist_template = models.JSONField(default=list, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class ClinicalProcedure(SoftDeleteModel, TimeStampedModel):
    patient = models.ForeignKey(PatientProfile, on_delete=models.CASCADE, related_name="procedures")
    doctor = models.ForeignKey(DoctorProfile, on_delete=models.PROTECT, related_name="procedures")
    appointment = models.ForeignKey(
        "appointments.Appointment", on_delete=models.SET_NULL, null=True, blank=True, related_name="procedures"
    )
    encounter = models.ForeignKey(
        "encounters.Encounter", on_delete=models.SET_NULL, null=True, blank=True, related_name="procedures"
    )
    template = models.ForeignKey(
        ProcedureTemplate, on_delete=models.SET_NULL, null=True, blank=True, related_name="procedures"
    )

    procedure_name = models.CharField(max_length=255, blank=True)
    procedure_name_ar = models.CharField(max_length=255, blank=True)
    status = models.CharField(
        max_length=12, choices=ProcedureStatus.choices, default=ProcedureStatus.SCHEDULED, db_index=True
    )

    # [{"step": str, "required": bool, "completed": bool}, ...] — copied from
    # template.checklist_template at creation time; edits to the master
    # template never retroactively change an already-created procedure.
    checklist_state = models.JSONField(default=list, blank=True)

    pre_procedure_notes = models.TextField(blank=True)
    post_procedure_notes = models.TextField(blank=True)
    complications = models.TextField(blank=True)

    start_time = models.DateTimeField(null=True, blank=True)
    end_time = models.DateTimeField(null=True, blank=True)
    cancellation_reason = models.TextField(blank=True, default="")
    cancelled_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["patient", "status"]),
            models.Index(fields=["doctor", "status"]),
        ]

    def save(self, *args, **kwargs):
        if self.template_id and not self.procedure_name:
            self.procedure_name = self.template.name
            self.procedure_name_ar = self.template.name_ar
        if self.template_id and not self.checklist_state and self._state.adding:
            self.checklist_state = [
                {**step, "completed": False} for step in self.template.checklist_template
            ]
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.procedure_name} ({self.status})"
