"""Atomic state transitions for RadiologyOrder."""
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.core.enums import NotificationVerb, RadiologyModality, RadiologyOrderStatus, ScanCategory
from apps.notifications.services import notify

from .models import RadiologyOrder, RadiologyTemplate

CANCELLABLE_STATUSES = frozenset({RadiologyOrderStatus.ORDERED, RadiologyOrderStatus.COMPLETED})

# RadiologyOrder/RadiologyTemplate use RadiologyModality (which has PET, no
# DICOM); the pre-existing Scan.category uses the separate ScanCategory enum
# (DICOM, no PET). Map the two so completing an order can create a Scan
# without touching Scan's own, independently-evolving category choices.
_MODALITY_TO_SCAN_CATEGORY = {
    RadiologyModality.XRAY: ScanCategory.XRAY,
    RadiologyModality.MRI: ScanCategory.MRI,
    RadiologyModality.CT: ScanCategory.CT,
    RadiologyModality.ULTRASOUND: ScanCategory.ULTRASOUND,
    RadiologyModality.PET: ScanCategory.OTHER,
    RadiologyModality.OTHER: ScanCategory.OTHER,
}


def _assert_status(order: RadiologyOrder, expected: str, action: str) -> None:
    if order.status != expected:
        raise ValidationError(
            {"status": f"Cannot {action}: order is '{order.status}', expected '{expected}'."}
        )


def notify_ordered(order: RadiologyOrder) -> None:
    notify(
        recipient=order.patient.user,
        verb=NotificationVerb.RADIOLOGY_ORDER_CREATED,
        title="Radiology order created",
        body=f"A radiology study '{order.study_name}' has been ordered for you.",
        related=order,
    )


def complete_order(order: RadiologyOrder, *, file, uploaded_by, description: str = "") -> RadiologyOrder:
    _assert_status(order, RadiologyOrderStatus.ORDERED, "complete")

    from apps.medical_records.models import Scan  # local import avoids an app-loading cycle

    modality = order.template.modality if order.template_id else RadiologyModality.OTHER
    Scan.objects.create(
        patient=order.patient,
        uploaded_by=uploaded_by,
        category=_MODALITY_TO_SCAN_CATEGORY.get(modality, ScanCategory.OTHER),
        file=file,
        description=description,
        appointment=order.appointment,
        radiology_order=order,
    )

    order.status = RadiologyOrderStatus.COMPLETED
    order.completed_at = timezone.now()
    order.save(update_fields=["status", "completed_at", "updated_at"])
    notify(
        recipient=order.patient.user,
        verb=NotificationVerb.RADIOLOGY_ORDER_COMPLETED,
        title="Radiology scan completed",
        body=f"Your radiology study '{order.study_name}' has been completed.",
        related=order,
    )
    return order


def report_order(order: RadiologyOrder, *, findings: str, impression: str) -> RadiologyOrder:
    _assert_status(order, RadiologyOrderStatus.COMPLETED, "report")

    order.findings = findings
    order.impression = impression
    order.status = RadiologyOrderStatus.REPORTED
    order.reported_at = timezone.now()
    order.save(update_fields=["findings", "impression", "status", "reported_at", "updated_at"])
    notify(
        recipient=order.patient.user,
        verb=NotificationVerb.RADIOLOGY_ORDER_REPORTED,
        title="Radiology report available",
        body=f"The report for your '{order.study_name}' study is now available.",
        related=order,
    )
    return order


def cancel_order(order: RadiologyOrder, reason: str, cancelled_by) -> RadiologyOrder:
    if order.status not in CANCELLABLE_STATUSES:
        raise ValidationError({"status": f"Cannot cancel an order with status '{order.status}'."})
    order.status = RadiologyOrderStatus.CANCELLED
    order.cancellation_reason = reason
    order.cancelled_at = timezone.now()
    order.save(update_fields=["status", "cancellation_reason", "cancelled_at", "updated_at"])
    notify(
        recipient=order.patient.user,
        verb=NotificationVerb.RADIOLOGY_ORDER_CANCELLED,
        title="Radiology order cancelled",
        body=f"Your radiology order '{order.study_name}' has been cancelled.",
        related=order,
    )
    return order


def seed_radiology_templates() -> dict:
    """Idempotent master-data seed: create-or-update by name."""
    created = 0
    updated = 0
    for row in _SEED_TEMPLATES:
        obj = RadiologyTemplate.objects.filter(name__iexact=row["name"]).first()
        if obj is None:
            RadiologyTemplate.objects.create(**row)
            created += 1
        else:
            for key, value in row.items():
                setattr(obj, key, value)
            obj.save()
            updated += 1
    return {"created": created, "updated": updated}


_SEED_TEMPLATES = [
    {
        "name": "Chest X-Ray",
        "name_ar": "أشعة سينية على الصدر",
        "modality": "XRAY",
        "body_part": "Chest",
        "instructions": "Remove any jewelry or metal objects from the chest and neck area.",
    },
    {
        "name": "Abdominal Ultrasound",
        "name_ar": "الموجات فوق الصوتية على البطن",
        "modality": "ULTRASOUND",
        "body_part": "Abdomen",
        "instructions": "Fast for 8 hours before the exam; drink water to keep the bladder full.",
    },
    {
        "name": "Head CT",
        "name_ar": "أشعة مقطعية على الرأس",
        "modality": "CT",
        "body_part": "Head",
        "instructions": "No special preparation required. Inform staff of any contrast allergies.",
    },
    {
        "name": "Knee MRI",
        "name_ar": "رنين مغناطيسي على الركبة",
        "modality": "MRI",
        "body_part": "Knee",
        "instructions": "Remove all metal objects. Inform staff of any implants or pacemakers before the scan.",
    },
    {
        "name": "PET-CT Whole Body",
        "name_ar": "بيت-سي تي للجسم بالكامل",
        "modality": "PET",
        "body_part": "Whole body",
        "instructions": "Fast for 6 hours before the exam; avoid strenuous exercise for 24 hours prior.",
    },
    {
        "name": "Other Imaging Study",
        "name_ar": "دراسة تصوير أخرى",
        "modality": "OTHER",
        "body_part": "",
        "instructions": "",
    },
]
