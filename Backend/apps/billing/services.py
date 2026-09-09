"""Billing business logic (Phase 12; ledger wiring is financial roadmap Tasks 6-7).

Entry points:
- `handle_appointment_completed(appointment, *, user)` — called by
  appointments.services.complete_appointment(). Either consumes a free
  follow-up (FeeValidity) or issues a consultation invoice (posting it to the
  ledger — see `post_invoice_issued`); also surfaces the patient's overdue
  balance (if any) as a receptionist-facing warning when a free visit is
  consumed — see `_overdue_balance`.
- `record_payment(...)` — applies money to an invoice, keeps
  paid_amount/balance/status consistent, and posts the receipt to the ledger.
  An overpayment is never refused: the excess becomes a `PatientDeposit`
  (a liability), and only the invoice's actual balance is applied to AR.
- `issue_credit_note(...)` / `issue_refund(...)` / `cancel_invoice(...)` —
  Task 7 corrections. All three post a ledger entry and never edit/delete
  the original invoice's totals — see each function's docstring.
- `billing_report(period)` — manager aggregates (billed/collected/outstanding
  + per-doctor revenue split).

Pricing precedence for a consultation: the doctor's own `consultation_fee`
(DoctorProfile extension hook) wins when set; otherwise the active CONSULTATION
`ServiceItem` catalog price; a catalog entry is bootstrapped from settings if
the clinic never configured one.

Ledger direction: this module calls `apps.accounting.services.post()`;
`apps.accounting` never imports anything from here.
"""
from datetime import timedelta
from decimal import ROUND_HALF_UP, Decimal

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import F, Sum
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.accounting import services as accounting_services
from apps.accounting.models import AccountMap, JournalEntry
from apps.core.enums import (
    BillingSourceType,
    InvoiceStatus,
    PaymentMethod,
    ServiceItemType,
)

from .models import CreditNote, FeeValidity, Invoice, InvoiceItem, Payment, PatientDeposit, Refund, ServiceItem

# payment_method -> (AccountMap purpose, qualifier) for the debit side of a receipt.
_CASH_PURPOSE_BY_PAYMENT_METHOD = {
    PaymentMethod.CASH: ("CASH_DEFAULT", ""),
    PaymentMethod.CARD: ("GATEWAY_CLEARING", "CARD"),
    PaymentMethod.BANK_TRANSFER: ("BANK_DEFAULT", ""),
}

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


def _overdue_balance(patient_user, today):
    """Sum of `balance` on the patient's overdue invoices.

    A receivables question, not an entitlement one: this is informational
    only, for the front desk to see — it is never a reason to refuse a free
    follow-up (see `handle_appointment_completed`).
    """
    return (
        Invoice.objects.filter(
            patient=patient_user,
            status__in=(InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID),
            due_date__lt=today,
        ).aggregate(total=Sum("balance"))["total"] or Decimal("0.00")
    )


def post_invoice_issued(invoice, *, user):
    """Post the `Invoice:{id}:issue` ledger entry (financial roadmap Task 6).

    Revenue is recorded gross, one line per service category, with the
    discount (if any) as its own debit-side line — never netted into revenue.
    A no-op (via post()'s own idempotency) if this invoice was already posted.

    Every line is added only if its amount is non-zero: the posting pipeline
    requires exactly one non-zero side per line, and a zero-priced item (an
    unconfigured Task 8 catalog entry bootstraps at 0.00 — see `_catalog_price`
    — so this is a real, expected case) would otherwise build an invalid
    zero/zero line. A wholly free invoice simply posts nothing.
    """
    revenue_by_category = {}
    for item in invoice.items.select_related("service_item").all():
        if not item.line_total:
            continue
        category = item.service_item.item_type if item.service_item else ServiceItemType.OTHER
        revenue_by_category[category] = (
            revenue_by_category.get(category, Decimal("0.00")) + item.line_total
        )

    lines = []
    if invoice.total:
        lines.append({
            "account": AccountMap.resolve("AR_PATIENT"),
            "debit": invoice.total,
            "party_type": "Patient",
            "party_id": invoice.patient_id,
        })
    for category, amount in revenue_by_category.items():
        lines.append({
            "account": AccountMap.resolve("REVENUE_BY_SERVICE_CATEGORY", category),
            "credit": amount,
            "doctor": invoice.doctor,
        })
    if invoice.discount:
        lines.append({"account": AccountMap.resolve("DISCOUNT"), "debit": invoice.discount})

    if not lines:
        return None

    return accounting_services.post(
        posting_date=invoice.invoice_date,
        source_type="Invoice",
        source_id=invoice.id,
        description=f"Invoice {invoice.number}",
        lines=lines,
        idempotency_key=f"Invoice:{invoice.id}:issue",
        user=user,
    )


def post_payment_received(payment, *, applied, overpayment):
    """Post the `Payment:{id}:receipt` ledger entry (financial roadmap Task 6).

    The debit-side account varies by `payment_method` (cash till, bank, or
    gateway clearing for cards not yet settled to the bank). `applied` (what
    actually pays down this invoice's AR) and `overpayment` (Task 7: routed to
    the patient-credit-balance liability instead, never revenue) always sum to
    `payment.amount`. Neither line carries a party — PATIENT_CREDIT_BALANCE
    isn't a RECEIVABLE/PAYABLE account, and the posting pipeline forbids a
    party there; `PatientDeposit.patient` is the record of whose money it is.
    """
    purpose, qualifier = _CASH_PURPOSE_BY_PAYMENT_METHOD[payment.payment_method]
    lines = [{"account": AccountMap.resolve(purpose, qualifier), "debit": payment.amount}]
    if applied:
        lines.append({
            "account": AccountMap.resolve("AR_PATIENT"), "credit": applied,
            "party_type": "Patient", "party_id": payment.invoice.patient_id,
        })
    if overpayment:
        lines.append({"account": AccountMap.resolve("PATIENT_CREDIT_BALANCE"), "credit": overpayment})

    return accounting_services.post(
        posting_date=timezone.localtime(payment.paid_at).date(),
        source_type="Payment",
        source_id=payment.id,
        description=f"Payment for {payment.invoice.number}",
        lines=lines,
        idempotency_key=f"Payment:{payment.id}:receipt",
        user=payment.received_by,
    )


@transaction.atomic
def handle_appointment_completed(appointment, *, user):
    """Billing hook for a COMPLETED appointment.

    Returns (invoice, fee_validity, arrears_balance):
    - Free follow-up consumed  -> (None, fee_validity, arrears_balance)
    - New invoice issued       -> (invoice, new_fee_validity, Decimal("0.00"))
    - Already billed (idempotent re-complete) -> (existing_invoice, None, Decimal("0.00"))

    `arrears_balance` is the patient's overdue balance from other invoices,
    checked at the point a free visit is consumed. The visit is never
    refused because of it — the receptionist decides what to do with the
    warning.
    """
    patient_user = appointment.patient.user
    doctor_user = appointment.doctor.user
    today = timezone.localdate()

    # Idempotency: completing the same appointment twice must not double-bill.
    existing = InvoiceItem.objects.filter(
        source_type=BillingSourceType.APPOINTMENT, source_id=appointment.id
    ).select_related("invoice").first()
    if existing is not None:
        return existing.invoice, None, Decimal("0.00")

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
        arrears_balance = _overdue_balance(patient_user, today)
        return None, validity, arrears_balance

    # No free visit -> issue a consultation invoice from the catalog.
    service_item = _consultation_service_item()
    price = _consultation_price(appointment.doctor, service_item)

    try:
        with transaction.atomic():
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
    except IntegrityError:
        # Race: another request won between the idempotency check above and
        # this insert. Return its invoice instead of double-billing.
        existing = InvoiceItem.objects.filter(
            source_type=BillingSourceType.APPOINTMENT, source_id=appointment.id
        ).select_related("invoice").first()
        return existing.invoice, None, Decimal("0.00")

    invoice.recalculate_totals()
    post_invoice_issued(invoice, user=user)

    new_validity = FeeValidity.objects.create(
        patient=patient_user,
        doctor=doctor_user,
        invoice=invoice,
        valid_from=today,
        valid_until=today + timedelta(days=settings.BILLING_FOLLOWUP_DAYS),
    )
    return invoice, new_validity, Decimal("0.00")


_DEFAULT_ITEM_NAME_BY_TYPE = {
    ServiceItemType.PROCEDURE: "Clinical Procedure",
    ServiceItemType.RADIOLOGY: "Radiology Study",
    ServiceItemType.LAB_TEST: "Laboratory Test",
}


def _catalog_price(item_type):
    """The active catalog price for `item_type`; bootstrap one at 0.00 if the
    clinic never configured it (same reasoning as `_consultation_service_item`
    — billing a completed procedure/scan/lab-order must never become a hard
    failure that blocks the underlying clinical action. A 0.00 invoice is a
    visible prompt for the clinic to add real pricing, not a silent guess at
    what the charge should be.
    """
    item = ServiceItem.objects.filter(item_type=item_type, is_active=True).order_by("id").first()
    if item is None:
        item = ServiceItem.objects.create(
            name=_DEFAULT_ITEM_NAME_BY_TYPE.get(item_type, item_type),
            item_type=item_type,
            default_price=Decimal("0.00"),
        )
    return item


@transaction.atomic
def bill_ad_hoc_service(
    *, patient_user, doctor_user, source_type, source_id, item_type, description, user,
):
    """The Task-1 pattern (unique constraint + IntegrityError handler),
    generalised for every non-appointment billing source (financial roadmap
    Task 8: procedures, radiology, lab orders). One InvoiceItem per source,
    exactly once — `InvoiceItem`'s existing
    `UniqueConstraint(["source_type", "source_id"])` from Task 1 already
    protects every source generically; it was never APPOINTMENT-specific.
    """
    existing = InvoiceItem.objects.filter(
        source_type=source_type, source_id=source_id,
    ).select_related("invoice").first()
    if existing is not None:
        return existing.invoice

    service_item = _catalog_price(item_type)
    today = timezone.localdate()

    try:
        with transaction.atomic():
            invoice = Invoice.objects.create(
                patient=patient_user,
                doctor=doctor_user,
                due_date=today + timedelta(days=settings.BILLING_INVOICE_DUE_DAYS),
                status=InvoiceStatus.ISSUED,
                currency=settings.BILLING_CURRENCY,
            )
            InvoiceItem.objects.create(
                invoice=invoice,
                description=description or service_item.name,
                service_item=service_item,
                quantity=1,
                unit_price=service_item.default_price,
                source_type=source_type,
                source_id=source_id,
            )
    except IntegrityError:
        # Race: another request won between the idempotency check above and
        # this insert. Return its invoice instead of double-billing.
        existing = InvoiceItem.objects.filter(
            source_type=source_type, source_id=source_id,
        ).select_related("invoice").first()
        return existing.invoice

    invoice.recalculate_totals()
    post_invoice_issued(invoice, user=user)
    return invoice


def handle_procedure_completed(procedure, *, user):
    """Bill a completed `ClinicalProcedure` — financial roadmap Task 8."""
    return bill_ad_hoc_service(
        patient_user=procedure.patient.user,
        doctor_user=procedure.doctor.user,
        source_type=BillingSourceType.PROCEDURE,
        source_id=procedure.id,
        item_type=ServiceItemType.PROCEDURE,
        description=procedure.procedure_name,
        user=user,
    )


def handle_radiology_order_completed(order, *, user):
    """Bill a completed `RadiologyOrder` (scan performed) — financial roadmap Task 8."""
    return bill_ad_hoc_service(
        patient_user=order.patient.user,
        doctor_user=order.doctor.user,
        source_type=BillingSourceType.RADIOLOGY_ORDER,
        source_id=order.id,
        item_type=ServiceItemType.RADIOLOGY,
        description=order.study_name or "Radiology scan",
        user=user,
    )


def handle_lab_order_completed(order, *, user):
    """Bill a completed `LabOrder` (results entered) — financial roadmap Task 8."""
    return bill_ad_hoc_service(
        patient_user=order.patient.user,
        doctor_user=order.doctor.user,
        source_type=BillingSourceType.LAB_ORDER,
        source_id=order.id,
        item_type=ServiceItemType.LAB_TEST,
        description=f"Laboratory tests ({order.order_number})",
        user=user,
    )


@transaction.atomic
def record_payment(*, invoice, amount, payment_method, received_by, reference=""):
    """Apply a payment and keep the invoice's money fields + status in sync.

    An amount over the remaining balance is never refused (financial roadmap
    Task 7): only `invoice.balance` is applied to this invoice, and the excess
    becomes a `PatientDeposit` — a liability, held for the patient rather than
    recognised as revenue, usable on a future invoice.
    """
    invoice = Invoice.objects.select_for_update().get(pk=invoice.pk)

    if invoice.status not in PAYABLE_STATUSES:
        raise ValidationError(
            {"invoice": f"Payments cannot be recorded on a {invoice.status} invoice."}
        )
    amount = Decimal(amount)
    if amount <= 0:
        raise ValidationError({"amount": "Payment amount must be greater than zero."})

    applied = min(amount, invoice.balance)
    overpayment = amount - applied

    payment = Payment.objects.create(
        invoice=invoice,
        amount=amount,
        payment_method=payment_method,
        received_by=received_by,
        reference=reference,
    )
    entry = post_payment_received(payment, applied=applied, overpayment=overpayment)

    if overpayment:
        PatientDeposit.objects.create(
            patient=invoice.patient, amount=overpayment, journal_entry=entry,
        )

    invoice.paid_amount = min(
        invoice.payments.aggregate(s=Sum("amount"))["s"] or Decimal("0.00"), invoice.total,
    )
    invoice.status = (
        InvoiceStatus.PAID
        if invoice.paid_amount >= invoice.total
        else InvoiceStatus.PARTIALLY_PAID
    )
    invoice.save(update_fields=["paid_amount", "status", "updated_at"])  # save() re-derives balance
    return payment


def _allocate_proportionally(total, weights):
    """Distribute `total` across `weights`' ratios so the parts sum back to
    `total` exactly — never a bare `total * w / sum(weights)` per part, which
    can be off by a cent after rounding. The last part absorbs the remainder."""
    if not weights:
        return []
    weight_sum = sum(weights, Decimal("0.00"))
    if weight_sum == 0:
        weights = [Decimal("1")] * len(weights)
        weight_sum = Decimal(len(weights))

    shares = []
    running = Decimal("0.00")
    for weight in weights[:-1]:
        share = (total * weight / weight_sum).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        shares.append(share)
        running += share
    shares.append(total - running)
    return shares


def _revenue_by_category(invoice):
    totals = {}
    for item in invoice.items.select_related("service_item").all():
        category = item.service_item.item_type if item.service_item else ServiceItemType.OTHER
        totals[category] = totals.get(category, Decimal("0.00")) + item.line_total
    return totals


@transaction.atomic
def issue_credit_note(*, invoice, amount, reason_code, approved_by):
    """Reduce what's owed on `invoice` by `amount` (full or partial — financial
    roadmap Task 7). Posts Dr revenue / Cr AR, proportionally reversing
    whatever service categories made up the invoice; the discount line (if
    any) is untouched — a credit note is relief beyond the original terms,
    not a correction of the original discount decision.
    """
    invoice = Invoice.objects.select_for_update().get(pk=invoice.pk)
    amount = Decimal(amount)
    if amount <= 0:
        raise ValidationError({"amount": "Credit note amount must be greater than zero."})
    if not reason_code:
        raise ValidationError({"reason_code": "A credit note requires a reason_code."})

    remaining = invoice.total - invoice.credited_amount
    if amount > remaining:
        raise ValidationError({
            "amount": (
                f"Credit note ({amount}) exceeds the invoice's remaining "
                f"creditable amount ({remaining})."
            ),
        })

    revenue_totals = _revenue_by_category(invoice)
    categories = list(revenue_totals)
    shares = _allocate_proportionally(amount, [revenue_totals[c] for c in categories])

    credit_note = CreditNote.objects.create(
        invoice=invoice, amount=amount, reason_code=reason_code, approved_by=approved_by,
    )
    lines = [{
        "account": AccountMap.resolve("AR_PATIENT"), "credit": amount,
        "party_type": "Patient", "party_id": invoice.patient_id,
    }]
    for category, share in zip(categories, shares):
        if share:
            lines.append({
                "account": AccountMap.resolve("REVENUE_BY_SERVICE_CATEGORY", category),
                "debit": share, "doctor": invoice.doctor,
            })

    entry = accounting_services.post(
        posting_date=timezone.localdate(),
        source_type="CreditNote",
        source_id=credit_note.id,
        description=f"Credit note for {invoice.number}",
        lines=lines,
        idempotency_key=f"CreditNote:{credit_note.id}:issue",
        reason_code=reason_code,
        user=approved_by,
    )
    credit_note.journal_entry = entry
    credit_note.save(update_fields=["journal_entry", "updated_at"])

    invoice.credited_amount = invoice.credited_amount + amount
    invoice.save(update_fields=["credited_amount", "updated_at"])
    return credit_note


@transaction.atomic
def issue_refund(*, invoice, amount, payment_method, reason_code, approved_by):
    """Pay back money already collected on `invoice`. Can never exceed what
    was actually collected and not already refunded (financial roadmap Task 7).
    """
    invoice = Invoice.objects.select_for_update().get(pk=invoice.pk)
    amount = Decimal(amount)
    if amount <= 0:
        raise ValidationError({"amount": "Refund amount must be greater than zero."})
    if not reason_code:
        raise ValidationError({"reason_code": "A refund requires a reason_code."})

    already_refunded = invoice.refunds.aggregate(s=Sum("amount"))["s"] or Decimal("0.00")
    available = invoice.paid_amount - already_refunded
    if amount > available:
        raise ValidationError({
            "amount": (
                f"Refund ({amount}) exceeds what was collected and not yet "
                f"refunded ({available})."
            ),
        })

    refund = Refund.objects.create(
        invoice=invoice, amount=amount, payment_method=payment_method,
        reason_code=reason_code, approved_by=approved_by,
    )
    purpose, qualifier = _CASH_PURPOSE_BY_PAYMENT_METHOD[payment_method]
    entry = accounting_services.post(
        posting_date=timezone.localdate(),
        source_type="Refund",
        source_id=refund.id,
        description=f"Refund for {invoice.number}",
        lines=[
            {
                "account": AccountMap.resolve("AR_PATIENT"), "debit": amount,
                "party_type": "Patient", "party_id": invoice.patient_id,
            },
            {"account": AccountMap.resolve(purpose, qualifier), "credit": amount},
        ],
        idempotency_key=f"Refund:{refund.id}:pay",
        reason_code=reason_code,
        user=approved_by,
    )
    refund.journal_entry = entry
    refund.save(update_fields=["journal_entry", "updated_at"])

    invoice.refunded_amount = already_refunded + amount
    invoice.save(update_fields=["refunded_amount", "updated_at"])  # save() re-derives balance
    return refund


@transaction.atomic
def cancel_invoice(*, invoice, reason_code, cancelled_by):
    """Cancel `invoice`: reverse its posting entry, never edit or delete it.

    Restricted to invoices with nothing collected yet — an invoice with
    payments recorded needs a `Refund` first (issuing both atomically would
    hide the fact that money actually moved).
    """
    if not reason_code:
        raise ValidationError({"reason_code": "Cancelling an invoice requires a reason_code."})

    invoice = Invoice.objects.select_for_update().get(pk=invoice.pk)
    if invoice.status == InvoiceStatus.CANCELLED:
        raise ValidationError({"invoice": "This invoice is already cancelled."})
    if invoice.paid_amount:
        raise ValidationError({
            "invoice": "Cannot cancel an invoice with payments recorded — issue a refund first.",
        })

    original_entry = JournalEntry.objects.filter(
        idempotency_key=f"Invoice:{invoice.id}:issue"
    ).first()
    if original_entry is not None:
        accounting_services.reverse(original_entry, reason_code=reason_code, user=cancelled_by)

    invoice.status = InvoiceStatus.CANCELLED
    invoice.credited_amount = invoice.total
    invoice.save(update_fields=["status", "credited_amount", "updated_at"])
    return invoice


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
