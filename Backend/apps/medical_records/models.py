"""Clinical data models. APIs/UI are Phase 2; the schema lives here now so
later phases add behavior, not migrations.

Append-only by design: 'edits' create a new MedicalRecord version (version chain
via `supersedes` + `is_current`) and rows are only ever soft-deleted."""
from pathlib import Path
from uuid import uuid4

from django.db import models, transaction
from django.utils import timezone

from apps.core.enums import LabCategory, LabOrderPriority, LabOrderStatus, PrescriptionStatus, SampleType, ScanCategory
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
    # Phase 10: optional structured link to the coded diagnosis master. The
    # free-text `diagnosis` above stays the canonical display string (timeline,
    # PDF, AI scribe all read it).
    diagnosis_ref = models.ForeignKey(
        "encounters.Diagnosis", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="medical_records",
    )
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
    encounter = models.ForeignKey("encounters.Encounter", on_delete=models.SET_NULL, null=True, blank=True, related_name="prescriptions")
    issued_date = models.DateField(auto_now_add=True)
    notes = models.TextField(blank=True)
    notes_ar = models.TextField(blank=True)
    status = models.CharField(max_length=12, choices=PrescriptionStatus.choices, default=PrescriptionStatus.ACTIVE)
    pdf_file = models.FileField(upload_to=prescription_pdf_path, null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancelled_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="cancelled_prescriptions",
    )
    cancellation_reason = models.TextField(blank=True)

    def __str__(self):
        return f"Prescription for {self.patient} ({self.issued_date})"


class PrescriptionItem(models.Model):
    prescription = models.ForeignKey(Prescription, on_delete=models.CASCADE, related_name="items")
    # Phase 9: optional link to the medication master. `drug_name` is kept as a
    # free-text fallback for unlisted drugs and backward compatibility.
    medication = models.ForeignKey(
        "medications.Medication", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="prescription_items",
    )
    drug_name = models.CharField(max_length=200)
    dosage_strength = models.CharField(max_length=100, blank=True)  # e.g. "500mg"
    dosage_form = models.ForeignKey(
        "medications.DosageForm", on_delete=models.SET_NULL, null=True, blank=True,
    )
    dosage_pattern = models.ForeignKey(
        "medications.DosagePattern", on_delete=models.SET_NULL, null=True, blank=True,
    )
    dosage = models.CharField(max_length=100, blank=True)
    frequency = models.CharField(max_length=100, blank=True)
    duration = models.CharField(max_length=100, blank=True)
    instructions = models.TextField(blank=True)
    instructions_ar = models.TextField(blank=True)
    quantity = models.PositiveIntegerField(null=True, blank=True)

    def __str__(self):
        return f"{self.drug_name} ({self.dosage})"


# ---------------------------------------------------------------------------
# Phase 6 — Lab Orders
# ---------------------------------------------------------------------------

def lab_order_result_path(instance, filename):
    ext = Path(filename).suffix.lower()
    return f"lab_orders/patient_{instance.order.patient_id}/{uuid4().hex}{ext}"


def _generate_order_number():
    year = timezone.now().year
    prefix = f"LAB-{year}-"
    with transaction.atomic():
        # select_for_update serialises concurrent writers so two requests
        # cannot both read the same last sequence number before either inserts.
        last = (
            LabOrder.all_objects.select_for_update()
            .filter(order_number__startswith=prefix)
            .order_by("-created_at")
            .values_list("order_number", flat=True)
            .first()
        )
        seq = int(last.split("-")[-1]) + 1 if last else 1
        return f"{prefix}{seq:04d}"


class LabOrder(SoftDeleteModel, TimeStampedModel):
    order_number = models.CharField(max_length=20, unique=True, editable=False)
    patient = models.ForeignKey(PatientProfile, on_delete=models.CASCADE, related_name="lab_orders")
    doctor = models.ForeignKey(DoctorProfile, on_delete=models.PROTECT, related_name="lab_orders")
    appointment = models.ForeignKey(
        "appointments.Appointment", on_delete=models.SET_NULL, null=True, blank=True, related_name="lab_orders"
    )
    encounter = models.ForeignKey(
        "encounters.Encounter", on_delete=models.SET_NULL, null=True, blank=True, related_name="lab_orders"
    )
    status = models.CharField(
        max_length=20, choices=LabOrderStatus.choices, default=LabOrderStatus.DRAFT, db_index=True
    )
    priority = models.CharField(
        max_length=10, choices=LabOrderPriority.choices, default=LabOrderPriority.ROUTINE
    )
    clinical_notes = models.TextField(blank=True)
    ordered_at = models.DateTimeField(null=True, blank=True)
    sample_collected_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
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
        if not self.order_number:
            self.order_number = _generate_order_number()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.order_number} ({self.status})"


def _generate_sample_id():
    date_str = timezone.now().strftime("%Y%m%d")
    prefix = f"LAB-{date_str}-"
    with transaction.atomic():
        last = (
            SampleCollection.objects.select_for_update()
            .filter(sample_id__startswith=prefix)
            .order_by("-id")
            .values_list("sample_id", flat=True)
            .first()
        )
        seq = int(last.split("-")[-1]) + 1 if last else 1
        return f"{prefix}{seq:04d}"


class SampleCollection(models.Model):
    """Specimen lifecycle tracking for external lab workflows (Phase 11)."""

    lab_order = models.OneToOneField(LabOrder, on_delete=models.CASCADE, related_name="sample_collection")
    sample_type = models.CharField(max_length=20, choices=SampleType.choices)
    sample_id = models.CharField(max_length=30, unique=True, editable=False)
    collected_by = models.ForeignKey(User, on_delete=models.PROTECT, related_name="collected_samples")
    collected_at = models.DateTimeField()
    sent_to_lab_at = models.DateTimeField(null=True, blank=True)
    received_at_lab = models.DateTimeField(null=True, blank=True)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["-collected_at"]

    def save(self, *args, **kwargs):
        if not self.sample_id:
            self.sample_id = _generate_sample_id()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.sample_id} ({self.sample_type})"


class LabOrderItem(models.Model):
    order = models.ForeignKey(LabOrder, on_delete=models.CASCADE, related_name="items")
    test_name = models.CharField(max_length=200)
    test_code = models.CharField(max_length=50, blank=True)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["id"]

    def __str__(self):
        return f"{self.test_name} [{self.order.order_number}]"


class LabOrderResult(models.Model):
    order = models.ForeignKey(LabOrder, on_delete=models.CASCADE, related_name="results")
    order_item = models.ForeignKey(
        LabOrderItem, on_delete=models.SET_NULL, null=True, blank=True, related_name="results"
    )
    test_name = models.CharField(max_length=200)
    result_value = models.CharField(max_length=255)
    unit = models.CharField(max_length=50, blank=True)
    reference_range = models.CharField(max_length=255, blank=True)
    is_abnormal = models.BooleanField(default=False)
    is_critical = models.BooleanField(default=False)
    result_date = models.DateField()
    entered_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name="entered_lab_results")
    file = models.FileField(upload_to=lab_order_result_path, null=True, blank=True)
    interpretation = models.CharField(max_length=500, blank=True)

    class Meta:
        ordering = ["order_item", "id"]

    def __str__(self):
        return f"{self.test_name}: {self.result_value} [{self.order.order_number}]"
