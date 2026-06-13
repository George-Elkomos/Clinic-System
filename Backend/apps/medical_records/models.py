"""Clinical data models. APIs/UI are Phase 2; the schema lives here now so
later phases add behavior, not migrations.

Append-only by design: 'edits' create a new MedicalRecord version (version chain
via `supersedes` + `is_current`) and rows are only ever soft-deleted."""
from pathlib import Path
from uuid import uuid4

from django.db import models

from apps.core.enums import LabCategory, PrescriptionStatus, ScanCategory
from apps.core.models import SoftDeleteModel, TimeStampedModel
from apps.doctors.models import DoctorProfile, SpecialtyCategory
from apps.users.models import PatientProfile, User


def scan_path(instance, filename):
    ext = Path(filename).suffix.lower()
    return f"scans/patient_{instance.patient_id}/{uuid4().hex}{ext}"


def lab_path(instance, filename):
    ext = Path(filename).suffix.lower()
    return f"lab_results/patient_{instance.patient_id}/{uuid4().hex}{ext}"


def prescription_pdf_path(instance, filename):
    return f"prescriptions/{uuid4().hex}.pdf"


class MedicalRecord(SoftDeleteModel, TimeStampedModel):
    patient = models.ForeignKey(PatientProfile, on_delete=models.CASCADE, related_name="medical_records")
    doctor = models.ForeignKey(DoctorProfile, on_delete=models.SET_NULL, null=True, related_name="authored_records")
    version = models.PositiveIntegerField(default=1)
    is_current = models.BooleanField(default=True)
    supersedes = models.ForeignKey("self", on_delete=models.SET_NULL, null=True, blank=True, related_name="superseded_by")
    chief_complaint = models.TextField(blank=True)
    diagnosis = models.TextField(blank=True)
    treatment_plan = models.TextField(blank=True)
    vitals = models.JSONField(default=dict, blank=True)
    appointment = models.ForeignKey("appointments.Appointment", on_delete=models.SET_NULL, null=True, blank=True, related_name="medical_records")

    class Meta:
        ordering = ["-version"]

    def __str__(self):
        return f"Record v{self.version} for {self.patient}"


class ClinicalNote(SoftDeleteModel, TimeStampedModel):
    """Tagged with a SpecialtyCategory; only a doctor whose specialties resolve to
    that category may create/edit it (read allowed to any treating doctor)."""

    medical_record = models.ForeignKey(MedicalRecord, on_delete=models.CASCADE, null=True, blank=True, related_name="notes")
    patient = models.ForeignKey(PatientProfile, on_delete=models.CASCADE, related_name="clinical_notes")
    doctor = models.ForeignKey(DoctorProfile, on_delete=models.SET_NULL, null=True, related_name="clinical_notes")
    specialty_category = models.ForeignKey(SpecialtyCategory, on_delete=models.PROTECT, related_name="clinical_notes")
    body = models.TextField()
    body_ar = models.TextField(blank=True)
    appointment = models.ForeignKey("appointments.Appointment", on_delete=models.SET_NULL, null=True, blank=True, related_name="clinical_notes")

    def __str__(self):
        return f"Note ({self.specialty_category}) for {self.patient}"


class Scan(SoftDeleteModel, TimeStampedModel):
    patient = models.ForeignKey(PatientProfile, on_delete=models.CASCADE, related_name="scans")
    uploaded_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name="uploaded_scans")
    category = models.CharField(max_length=12, choices=ScanCategory.choices, default=ScanCategory.OTHER)
    file = models.FileField(upload_to=scan_path)
    original_filename = models.CharField(max_length=255, blank=True)
    content_type = models.CharField(max_length=100, blank=True)
    file_size = models.PositiveIntegerField(default=0)
    description = models.TextField(blank=True)
    appointment = models.ForeignKey("appointments.Appointment", on_delete=models.SET_NULL, null=True, blank=True, related_name="scans")
    taken_at = models.DateField(null=True, blank=True)

    def __str__(self):
        return f"{self.category} scan for {self.patient}"


class LabResult(SoftDeleteModel, TimeStampedModel):
    patient = models.ForeignKey(PatientProfile, on_delete=models.CASCADE, related_name="lab_results")
    uploaded_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name="uploaded_labs")
    test_name = models.CharField(max_length=200)
    test_name_ar = models.CharField(max_length=200, blank=True)
    category = models.CharField(max_length=12, choices=LabCategory.choices, default=LabCategory.OTHER)
    result_value = models.CharField(max_length=255, blank=True)
    reference_range = models.CharField(max_length=255, blank=True)
    unit = models.CharField(max_length=50, blank=True)
    file = models.FileField(upload_to=lab_path, null=True, blank=True)
    result_date = models.DateField(null=True, blank=True)
    is_abnormal = models.BooleanField(default=False)
    appointment = models.ForeignKey("appointments.Appointment", on_delete=models.SET_NULL, null=True, blank=True, related_name="lab_results")

    def __str__(self):
        return f"{self.test_name} for {self.patient}"


class Prescription(SoftDeleteModel, TimeStampedModel):
    patient = models.ForeignKey(PatientProfile, on_delete=models.CASCADE, related_name="prescriptions")
    doctor = models.ForeignKey(DoctorProfile, on_delete=models.SET_NULL, null=True, related_name="prescriptions")
    appointment = models.ForeignKey("appointments.Appointment", on_delete=models.SET_NULL, null=True, blank=True, related_name="prescriptions")
    issued_date = models.DateField(auto_now_add=True)
    notes = models.TextField(blank=True)
    notes_ar = models.TextField(blank=True)
    status = models.CharField(max_length=12, choices=PrescriptionStatus.choices, default=PrescriptionStatus.ACTIVE)
    pdf_file = models.FileField(upload_to=prescription_pdf_path, null=True, blank=True)

    def __str__(self):
        return f"Prescription for {self.patient} ({self.issued_date})"


class PrescriptionItem(models.Model):
    prescription = models.ForeignKey(Prescription, on_delete=models.CASCADE, related_name="items")
    drug_name = models.CharField(max_length=200)
    dosage = models.CharField(max_length=100, blank=True)
    frequency = models.CharField(max_length=100, blank=True)
    duration = models.CharField(max_length=100, blank=True)
    instructions = models.TextField(blank=True)
    instructions_ar = models.TextField(blank=True)
    quantity = models.PositiveIntegerField(null=True, blank=True)

    def __str__(self):
        return f"{self.drug_name} ({self.dosage})"
