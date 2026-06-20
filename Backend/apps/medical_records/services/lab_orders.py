"""Atomic state transitions for LabOrder."""
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.core.enums import LabOrderPriority, LabOrderStatus, NotificationVerb
from apps.notifications.services import notify

from ..models import LabOrder, LabOrderResult

# Statuses from which an order may still be cancelled (pre-results).
CANCELLABLE_STATUSES = frozenset({
    LabOrderStatus.DRAFT,
    LabOrderStatus.ORDERED,
    LabOrderStatus.SAMPLE_COLLECTED,
    LabOrderStatus.PROCESSING,
})


def _assert_status(order: LabOrder, expected: str, action: str) -> None:
    if order.status != expected:
        raise ValidationError(
            {"status": f"Cannot {action}: order is '{order.status}', expected '{expected}'."}
        )


def submit_order(order: LabOrder) -> LabOrder:
    _assert_status(order, LabOrderStatus.DRAFT, "submit")
    order.status = LabOrderStatus.ORDERED
    order.ordered_at = timezone.now()
    order.save(update_fields=["status", "ordered_at", "updated_at"])
    notify(
        recipient=order.patient.user,
        verb=NotificationVerb.LAB_ORDER_CREATED,
        title="Lab order submitted",
        body=f"Your lab order {order.order_number} has been submitted.",
        related=order,
    )
    return order


def collect_sample(order: LabOrder) -> LabOrder:
    _assert_status(order, LabOrderStatus.ORDERED, "collect sample")
    order.status = LabOrderStatus.SAMPLE_COLLECTED
    order.sample_collected_at = timezone.now()
    order.save(update_fields=["status", "sample_collected_at", "updated_at"])

    # CW-6: STAT and URGENT orders skip the manual "send to lab" gate — the
    # lab processes them immediately.  Auto-advance straight to PROCESSING so
    # the result-entry queue shows them without a second secretary action.
    if order.priority in (LabOrderPriority.STAT, LabOrderPriority.URGENT):
        order.status = LabOrderStatus.PROCESSING
        order.save(update_fields=["status", "updated_at"])

    return order


def start_processing(order: LabOrder) -> LabOrder:
    _assert_status(order, LabOrderStatus.SAMPLE_COLLECTED, "start processing")
    order.status = LabOrderStatus.PROCESSING
    order.save(update_fields=["status", "updated_at"])
    return order


def complete_order(order: LabOrder, results_data: list, entered_by) -> LabOrder:
    _assert_status(order, LabOrderStatus.PROCESSING, "complete")

    # CW-4: Every result must name a test that was actually ordered, and any
    # order_item FK must belong to this specific order — not another order.
    ordered_names = set(order.items.values_list("test_name", flat=True))
    own_item_ids = set(order.items.values_list("id", flat=True))
    errors = []
    for i, rd in enumerate(results_data):
        test_name = rd.get("test_name", "")
        if test_name not in ordered_names:
            errors.append(
                f"Result #{i + 1}: test '{test_name}' was not included in the original order."
            )
        order_item = rd.get("order_item")
        if order_item is not None and order_item.id not in own_item_ids:
            errors.append(
                f"Result #{i + 1}: order_item #{order_item.id} belongs to a different order."
            )
    if errors:
        raise ValidationError({"results": errors})

    order.status = LabOrderStatus.COMPLETED
    order.completed_at = timezone.now()
    order.save(update_fields=["status", "completed_at", "updated_at"])

    has_critical = False
    for rd in results_data:
        result = LabOrderResult(order=order, entered_by=entered_by, **rd)
        result.save()
        if result.is_critical:
            has_critical = True

    notify(
        recipient=order.patient.user,
        verb=NotificationVerb.LAB_RESULT_AVAILABLE,
        title="Lab results available",
        body=f"Results for order {order.order_number} are ready.",
        related=order,
    )
    notify(
        recipient=order.doctor.user,
        verb=NotificationVerb.LAB_RESULT_AVAILABLE,
        title="Lab results ready for review",
        body=f"Results for {order.patient.user.get_full_name()} ({order.order_number}) are ready.",
        related=order,
    )
    if has_critical:
        # CW-3: Doctor receives a forced-channel alert (SMS + WhatsApp) so the
        # message arrives immediately even if they are away from the app.
        notify(
            recipient=order.doctor.user,
            verb=NotificationVerb.LAB_RESULT_CRITICAL,
            title="CRITICAL lab result",
            body=f"Critical value in order {order.order_number} — immediate review required.",
            related=order,
            channels=["sms", "whatsapp"],
        )
        # CW-3: Patient also receives an urgent notification so they know to
        # contact the clinic straight away while results are being reviewed.
        notify(
            recipient=order.patient.user,
            verb=NotificationVerb.LAB_RESULT_CRITICAL,
            title="Urgent: critical lab result",
            body=(
                f"A critical value was detected in your lab order {order.order_number}. "
                "Please contact the clinic immediately."
            ),
            related=order,
        )

    return order


def review_order(order: LabOrder) -> LabOrder:
    _assert_status(order, LabOrderStatus.COMPLETED, "review")
    order.status = LabOrderStatus.REVIEWED
    order.reviewed_at = timezone.now()
    order.save(update_fields=["status", "reviewed_at", "updated_at"])
    notify(
        recipient=order.patient.user,
        verb=NotificationVerb.LAB_RESULT_REVIEWED,
        title="Lab results reviewed",
        body=f"Your doctor has reviewed the results for order {order.order_number}.",
        related=order,
    )
    return order


def cancel_order(order: LabOrder, reason: str, cancelled_by) -> LabOrder:
    """Cancel an order that has not yet reached a terminal state.

    Only DRAFT through PROCESSING orders may be cancelled — COMPLETED and
    REVIEWED orders already have recorded results and cannot be undone here.
    """
    if order.status not in CANCELLABLE_STATUSES:
        raise ValidationError(
            {"status": f"Cannot cancel an order with status '{order.status}'."}
        )
    order.status = LabOrderStatus.CANCELLED
    order.cancellation_reason = reason
    order.cancelled_at = timezone.now()
    order.save(update_fields=["status", "cancellation_reason", "cancelled_at", "updated_at"])
    notify(
        recipient=order.patient.user,
        verb=NotificationVerb.LAB_ORDER_CANCELLED,
        title="Lab order cancelled",
        body=f"Your lab order {order.order_number} has been cancelled.",
        related=order,
    )
    return order
