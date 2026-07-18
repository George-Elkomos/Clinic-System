"""Billing business logic (Phase 12).

Three entry points:
- `handle_appointment_completed(appointment)` — called by
  appointments.services.complete_appointment(). Either consumes a free
  follow-up (FeeValidity) or issues a consultation invoice.
- `record_payment(...)` — applies money to an invoice and keeps
  paid_amount/balance/status consistent.
- `billing_report(period)` — manager aggregates (billed/collected/outstanding
  + per-doctor revenue split).

Pricing precedence for a consultation: the doctor's own `consultation_fee`
(DoctorProfile extension hook) wins when set; otherwise the active CONSULTATION
`ServiceItem` catalog price; a catalog entry is bootstrapped from settings if
the clinic never configured one.
"""
from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.db import transaction
from django.db.models import F, Sum
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.core.enums import (
    BillingSourceType,
    InvoiceStatus,
    ServiceItemType,
)

from .models import FeeValidity, Invoice, InvoiceItem, Payment, ServiceItem

# Statuses that count toward money owed / earned.
BILLABLE_STATUSES = (
    InvoiceStatus.ISSUED,
    InvoiceStatus.PARTIALLY_PAID,
    InvoiceStatus.PAID,
)
# Statuses a payment may be recorded against.
PAYABLE_STATUSES = (InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID)


def _consultation_service_item():
    """Active CONSULTATION catalog entry; bootstrap one if the catalog is empty."""
    item = (
        ServiceItem.objects.filter(
            item_type=ServiceItemType.CONSULTATION, is_active=True
        )
        .order_by("id")
        .first()
    )
    if item is None:
        item = ServiceItem.objects.create(
            name="General Consultation",
            name_ar="كشف عام",
            item_type=ServiceItemType.CONSULTATION,
            default_price=Decimal(settings.BILLING_DEFAULT_CONSULTATION_PRICE),
        )
    return item


def _consultation_price(doctor_profile, service_item):
    if doctor_profile and doctor_profile.consultation_fee is not None:
        return doctor_profile.consultation_fee
    return service_item.default_price


@transaction.atomic
def handle_appointment_completed(appointment):
    """Billing hook for a COMPLETED appointment.

    Returns (invoice, fee_validity):
    - Free follow-up consumed  -> (None, fee_validity)
    - New invoice issued       -> (invoice, new_fee_validity)
    - Already billed (idempotent re-complete) -> (existing_invoice, None)
    """
    patient_user = appointment.patient.user
    doctor_user = appointment.doctor.user
    today = timezone.localdate()

    # Idempotency: completing the same appointment twice must not double-bill.
    existing = InvoiceItem.objects.filter(
        source_type=BillingSourceType.APPOINTMENT, source_id=appointment.id
    ).select_related("invoice").first()
    if existing is not None:
        return existing.invoice, None

    # Active free-follow-up window for this (patient, doctor) pair?
    validity = (
        FeeValidity.objects.select_for_update()
        .filter(
            patient=patient_user,
            doctor=doctor_user,
            valid_from__lte=today,
            valid_until__gte=today,
            used_count__lt=F("max_free_visits"),
        )
        .order_by("valid_until")
        .first()
    )
    if validity is not None:
        validity.used_count = F("used_count") + 1
        validity.save(update_fields=["used_count", "updated_at"])
        validity.refresh_from_db()
        return None, validity

    # No free visit -> issue a consultation invoice from the catalog.
    service_item = _consultation_service_item()
    price = _consultation_price(appointment.doctor, service_item)

    invoice = Invoice.objects.create(
        patient=patient_user,
        doctor=doctor_user,
        due_date=today + timedelta(days=settings.BILLING_INVOICE_DUE_DAYS),
        status=InvoiceStatus.ISSUED,
        currency=settings.BILLING_CURRENCY,
    )
    InvoiceItem.objects.create(
        invoice=invoice,
        description=service_item.name,
        service_item=service_item,
        quantity=1,
        unit_price=price,
        source_type=BillingSourceType.APPOINTMENT,
        source_id=appointment.id,
    )
    invoice.recalculate_totals()

    new_validity = FeeValidity.objects.create(
        patient=patient_user,
        doctor=doctor_user,
        invoice=invoice,
        valid_from=today,
        valid_until=today + timedelta(days=settings.BILLING_FOLLOWUP_DAYS),
    )
    return invoice, new_validity


@transaction.atomic
def record_payment(*, invoice, amount, payment_method, received_by, reference=""):
    """Apply a payment and keep the invoice's money fields + status in sync."""
    invoice = Invoice.objects.select_for_update().get(pk=invoice.pk)

    if invoice.status not in PAYABLE_STATUSES:
        raise ValidationError(
            {"invoice": f"Payments cannot be recorded on a {invoice.status} invoice."}
        )
    amount = Decimal(amount)
    if amount <= 0:
        raise ValidationError({"amount": "Payment amount must be greater than zero."})
    if amount > invoice.balance:
        raise ValidationError(
            {"amount": (
                f"Payment ({amount}) exceeds the remaining balance "
                f"({invoice.balance}). Please enter the exact amount due or less."
            )}
        )

    payment = Payment.objects.create(
        invoice=invoice,
        amount=amount,
        payment_method=payment_method,
        received_by=received_by,
        reference=reference,
    )

    invoice.paid_amount = (
        invoice.payments.aggregate(s=Sum("amount"))["s"] or Decimal("0.00")
    )
    invoice.status = (
        InvoiceStatus.PAID
        if invoice.paid_amount >= invoice.total
        else InvoiceStatus.PARTIALLY_PAID
    )
    invoice.save(update_fields=["paid_amount", "status", "updated_at"])  # save() re-derives balance
    return payment


def _period_start(period):
    today = timezone.localdate()
    if period == "day":
        return today
    if period == "year":
        return today.replace(month=1, day=1)
    return today.replace(day=1)  # month (default)


def billing_report(period="month"):
    """Aggregate financials for the manager dashboard."""
    since = _period_start(period)

    invoices = Invoice.objects.filter(
        invoice_date__gte=since, status__in=BILLABLE_STATUSES
    )
    payments = Payment.objects.filter(paid_at__date__gte=since)

    total_billed = invoices.aggregate(s=Sum("total"))["s"] or Decimal("0.00")
    total_collected = payments.aggregate(s=Sum("amount"))["s"] or Decimal("0.00")
    total_outstanding = invoices.aggregate(s=Sum("balance"))["s"] or Decimal("0.00")

    by_doctor = list(
        invoices.filter(doctor__isnull=False)
        .values("doctor_id", "doctor__first_name", "doctor__last_name")
        .annotate(billed=Sum("total"), collected=Sum("paid_amount"))
        .order_by("-billed")
    )

    return {
        "period": period,
        "since": since,
        "currency": settings.BILLING_CURRENCY,
        "total_billed": total_billed,
        "total_collected": total_collected,
        "total_outstanding": total_outstanding,
        "revenue_by_doctor": [
            {
                "doctor_id": row["doctor_id"],
                "doctor_name": (
                    f"{row['doctor__first_name']} {row['doctor__last_name']}".strip()
                ),
                "total_billed": row["billed"] or Decimal("0.00"),
                "total_collected": row["collected"] or Decimal("0.00"),
            }
            for row in by_doctor
        ],
    }
