"""Append-only versioning for MedicalRecord. An 'edit' never mutates a row in
place: it creates a new version that supersedes the current one."""
from django.db import transaction
from django.db.models import Max

from ..models import MedicalRecord


@transaction.atomic
def create_record_version(*, patient, doctor, data):
    """Create the next MedicalRecord version for a patient.

    Flips the previous current version's `is_current` to False and links the new
    row via `supersedes`. `data` holds chief_complaint/diagnosis/treatment_plan/
    vitals/appointment.
    """
    current = (
        MedicalRecord.all_objects
        .select_for_update()
        .filter(patient=patient, is_current=True)
        .first()
    )
    next_version = (
        MedicalRecord.all_objects.filter(patient=patient)
        .aggregate(m=Max("version"))["m"] or 0
    ) + 1

    record = MedicalRecord.objects.create(
        patient=patient,
        doctor=doctor,
        version=next_version,
        is_current=True,
        supersedes=current,
        **data,
    )
    if current:
        current.is_current = False
        current.save(update_fields=["is_current", "updated_at"])
    return record
