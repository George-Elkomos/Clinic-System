"""Turn a reviewed draft into real clinical rows.

Called only from the commit endpoint, after a doctor has reviewed (and possibly
edited) the AI draft. Reuses the existing append-only record versioning so AI
records are indistinguishable from hand-entered ones.

Everything happens in one transaction: either the medical record AND the
prescription land, or nothing does.
"""
from django.db import transaction
from django.utils import timezone

from apps.medical_records.models import Prescription, PrescriptionItem
from apps.medical_records.services.records import create_record_version

from ..models import SessionStatus
from .schema import PRESCRIPTION_ITEM_KEYS, normalize_draft


@transaction.atomic
def commit_draft(session, draft, *, doctor, create_prescription=True):
    """Write `draft` (a normalized clinical draft) into MedicalRecord (+ optional
    Prescription) for the session's patient. Returns the session, refreshed."""
    draft = normalize_draft(draft)
    patient = session.patient

    vitals = {k: v for k, v in draft["vitals"].items() if v}

    record = create_record_version(
        patient=patient,
        doctor=doctor,
        data={
            "chief_complaint": draft["chief_complaint"],
            "diagnosis": draft["diagnosis"],
            "treatment_plan": draft["treatment_plan"],
            "vitals": vitals,
            "appointment": session.appointment,
        },
    )

    prescription = None
    items = draft["prescriptions"]
    if create_prescription and items:
        notes_parts = [p for p in (draft.get("clinical_summary"), draft.get("follow_up")) if p]
        prescription = Prescription.objects.create(
            patient=patient,
            doctor=doctor,
            appointment=session.appointment,
            notes="\n".join(notes_parts),
        )
        PrescriptionItem.objects.bulk_create([
            PrescriptionItem(
                prescription=prescription,
                **{k: item.get(k, "") for k in PRESCRIPTION_ITEM_KEYS},
            )
            for item in items
        ])

    session.committed_record = record
    session.committed_prescription = prescription
    session.status = SessionStatus.COMMITTED
    session.committed_at = timezone.now()
    # Persist the doctor-edited draft as the source of truth for this session.
    session.extracted = draft
    session.save(update_fields=[
        "committed_record", "committed_prescription", "status",
        "committed_at", "extracted", "updated_at",
    ])
    return session
