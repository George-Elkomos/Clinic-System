"""Encounter lifecycle services.

State machine:
    DRAFT --submit--> SUBMITTED --amend--> (original: AMENDED, not current)
                                          + new editable DRAFT twin (version+1)

Submitting mirrors the core fields into an append-only MedicalRecord version via
the existing records service, so the patient history / timeline stay consistent.
"""
from django.db import transaction
from rest_framework.exceptions import ValidationError

from apps.appointments.services import complete_appointment
from apps.core.enums import AppointmentStatus
from apps.medical_records.services.records import create_record_version

from .models import Encounter, EncounterStatus

# Fields copied when an encounter is amended into a new editable twin.
_CLINICAL_FIELDS = (
    "patient", "doctor", "appointment", "encounter_date",
    "chief_complaint", "chief_complaint_ar", "symptoms",
    "examination_findings", "examination_findings_ar",
    "diagnosis", "diagnosis_notes",
    "treatment_plan", "treatment_plan_ar", "vitals",
)


def get_or_create_draft(*, appointment, doctor):
    """Return the encounter already attached to `appointment`, or create a DRAFT."""
    existing = Encounter.objects.filter(appointment=appointment).first()
    if existing:
        return existing
    return Encounter.objects.create(
        patient=appointment.patient,
        doctor=doctor,
        appointment=appointment,
        status=EncounterStatus.DRAFT,
    )


@transaction.atomic
def submit_encounter(encounter):
    """DRAFT -> SUBMITTED. Completes the appointment and mirrors a MedicalRecord."""
    if encounter.status != EncounterStatus.DRAFT:
        raise ValidationError({"status": "Only a draft encounter can be submitted."})

    encounter.status = EncounterStatus.SUBMITTED
    encounter.save(update_fields=["status", "updated_at"])

    appointment = encounter.appointment
    if appointment and appointment.status != AppointmentStatus.COMPLETED:
        complete_appointment(appointment)

    create_record_version(
        patient=encounter.patient,
        doctor=encounter.doctor,
        data={
            "chief_complaint": encounter.chief_complaint,
            "diagnosis": encounter.diagnosis.name if encounter.diagnosis else "",
            "treatment_plan": encounter.treatment_plan,
            "appointment": appointment,
        },
    )
    return encounter


@transaction.atomic
def amend_encounter(encounter):
    """SUBMITTED -> mark original AMENDED/not-current; return editable DRAFT twin."""
    if encounter.status != EncounterStatus.SUBMITTED:
        raise ValidationError({"status": "Only a submitted encounter can be amended."})

    original = encounter
    twin = Encounter.objects.create(
        version=original.version + 1,
        is_current=True,
        status=EncounterStatus.DRAFT,
        supersedes=original,
        **{f: getattr(original, f) for f in _CLINICAL_FIELDS if f != "appointment"},
        # appointment is OneToOne — keep it on the original to avoid a unique clash.
    )

    original.is_current = False
    original.status = EncounterStatus.AMENDED
    original.save(update_fields=["is_current", "status", "updated_at"])
    return twin
