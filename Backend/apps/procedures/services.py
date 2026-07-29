"""Atomic state transitions for ClinicalProcedure."""
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.core.enums import NotificationVerb, ProcedureStatus
from apps.notifications.services import notify

from .models import ClinicalProcedure, ProcedureTemplate

CANCELLABLE_STATUSES = frozenset({ProcedureStatus.SCHEDULED, ProcedureStatus.IN_PROGRESS})


def _assert_status(procedure: ClinicalProcedure, expected: str, action: str) -> None:
    if procedure.status != expected:
        raise ValidationError(
            {"status": f"Cannot {action}: procedure is '{procedure.status}', expected '{expected}'."}
        )


def notify_scheduled(procedure: ClinicalProcedure) -> None:
    notify(
        recipient=procedure.patient.user,
        verb=NotificationVerb.PROCEDURE_SCHEDULED,
        title="Procedure scheduled",
        body=f"A procedure '{procedure.procedure_name}' has been scheduled for you.",
        related=procedure,
    )


def start_procedure(procedure: ClinicalProcedure) -> ClinicalProcedure:
    _assert_status(procedure, ProcedureStatus.SCHEDULED, "start")
    procedure.status = ProcedureStatus.IN_PROGRESS
    procedure.start_time = timezone.now()
    procedure.save(update_fields=["status", "start_time", "updated_at"])
    return procedure


def complete_procedure(procedure: ClinicalProcedure, post_procedure_notes=None, complications=None) -> ClinicalProcedure:
    _assert_status(procedure, ProcedureStatus.IN_PROGRESS, "complete")

    if post_procedure_notes is not None:
        procedure.post_procedure_notes = post_procedure_notes
    if complications is not None:
        procedure.complications = complications

    if not procedure.post_procedure_notes.strip():
        raise ValidationError(
            {"post_procedure_notes": "Post-procedure notes are required to complete a procedure."}
        )

    procedure.status = ProcedureStatus.COMPLETED
    procedure.end_time = timezone.now()
    procedure.save(update_fields=[
        "status", "end_time", "post_procedure_notes", "complications", "updated_at",
    ])
    notify(
        recipient=procedure.patient.user,
        verb=NotificationVerb.PROCEDURE_COMPLETED,
        title="Procedure completed",
        body=f"Your procedure '{procedure.procedure_name}' has been completed.",
        related=procedure,
    )
    return procedure


def cancel_procedure(procedure: ClinicalProcedure, reason: str, cancelled_by) -> ClinicalProcedure:
    if procedure.status not in CANCELLABLE_STATUSES:
        raise ValidationError({"status": f"Cannot cancel a procedure with status '{procedure.status}'."})
    procedure.status = ProcedureStatus.CANCELLED
    procedure.cancellation_reason = reason
    procedure.cancelled_at = timezone.now()
    procedure.save(update_fields=["status", "cancellation_reason", "cancelled_at", "updated_at"])
    notify(
        recipient=procedure.patient.user,
        verb=NotificationVerb.PROCEDURE_CANCELLED,
        title="Procedure cancelled",
        body=f"Your procedure '{procedure.procedure_name}' has been cancelled.",
        related=procedure,
    )
    return procedure


def seed_procedure_templates() -> dict:
    """Idempotent master-data seed: create-or-update by name."""
    created = 0
    updated = 0
    for row in _SEED_TEMPLATES:
        obj = ProcedureTemplate.objects.filter(name__iexact=row["name"]).first()
        if obj is None:
            ProcedureTemplate.objects.create(**row)
            created += 1
        else:
            for key, value in row.items():
                setattr(obj, key, value)
            obj.save()
            updated += 1
    return {"created": created, "updated": updated}


_SEED_TEMPLATES = [
    {
        "name": "Wound Suturing",
        "name_ar": "خياطة الجرح",
        "category": "MINOR_SURGERY",
        "description": "Closure of a skin laceration or surgical wound with sutures.",
        "estimated_duration_minutes": 30,
        "checklist_template": [
            {"step": "Obtain informed consent", "required": True},
            {"step": "Sterilize the wound area", "required": True},
            {"step": "Apply local anesthesia", "required": True},
            {"step": "Explore and irrigate the wound", "required": True},
            {"step": "Execute sutures", "required": True},
            {"step": "Apply sterile bandage", "required": True},
            {"step": "Provide wound care instructions", "required": False},
        ],
    },
    {
        "name": "Minor Skin Biopsy",
        "name_ar": "خزعة جلدية بسيطة",
        "category": "BIOPSY",
        "description": "Punch or shave biopsy of a suspicious skin lesion.",
        "estimated_duration_minutes": 20,
        "checklist_template": [
            {"step": "Obtain informed consent", "required": True},
            {"step": "Sterilize the biopsy site", "required": True},
            {"step": "Apply local anesthesia", "required": True},
            {"step": "Excise tissue sample", "required": True},
            {"step": "Achieve hemostasis", "required": True},
            {"step": "Label and send specimen to pathology", "required": True},
            {"step": "Apply dressing", "required": True},
        ],
    },
    {
        "name": "Intradermal / Intramuscular Injection",
        "name_ar": "حقنة داخل الأدمة / العضل",
        "category": "INJECTION",
        "description": "Administration of a medication via intradermal or intramuscular injection.",
        "estimated_duration_minutes": 10,
        "checklist_template": [
            {"step": "Verify medication and dose", "required": True},
            {"step": "Check for known allergies", "required": True},
            {"step": "Disinfect injection site", "required": True},
            {"step": "Administer injection", "required": True},
            {"step": "Observe patient for immediate reaction", "required": True},
        ],
    },
    {
        "name": "Dressing Change",
        "name_ar": "تغيير الضماد",
        "category": "DRESSING",
        "description": "Removal of an existing wound dressing, wound assessment, and application of a new dressing.",
        "estimated_duration_minutes": 15,
        "checklist_template": [
            {"step": "Remove old dressing", "required": True},
            {"step": "Assess wound for signs of infection", "required": True},
            {"step": "Cleanse the wound", "required": True},
            {"step": "Apply new sterile dressing", "required": True},
        ],
    },
    {
        "name": "General Procedure",
        "name_ar": "إجراء عام",
        "category": "OTHER",
        "description": "Free-form clinical procedure not covered by a specific template.",
        "estimated_duration_minutes": 15,
        "checklist_template": [
            {"step": "Obtain informed consent", "required": True},
            {"step": "Perform procedure", "required": True},
            {"step": "Document findings", "required": True},
        ],
    },
]
