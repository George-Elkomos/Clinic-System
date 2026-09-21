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
- `open_shift(...)` / `close_shift(...)` — Task 11 cashier shifts. Closing
  counts the drawer and posts the difference against `CASH_VARIANCE`; the
  expected figure is derived from the shift's own cash rows, never counted up
  as the shift runs.
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
    CashierShiftStatus,
    CashMovementType,
    FinancialOperation,
    InvoiceStatus,
    PaymentMethod,
    ServiceItemType,
)

from . import idempotency
from .approvals import require_authorization
from .models import (
    DEFAULT_TILL_ID,
    CashierShift,
    CashMovement,
    CreditNote,
    FeeValidity,
    Invoice,
    InvoiceItem,
    InvoiceNumberSequence,
    PatientDeposit,
    Payment,
    Refund,
    ServiceItem,
    WriteOff,
    WriteOffReversal,
)

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


def allocate_invoice_number(scope="default"):
    """Draw the next gapless invoice number (financial roadmap Task 14).

    MUST be called from inside the same `transaction.atomic()` block that
    creates the `Invoice` it will be assigned to (every call site in this
    module already does — see `handle_appointment_completed`,
    `bill_ad_hoc_service`). `select_for_update()` on the single sequence row
    serialises concurrent invoice creations onto it one at a time; if that
    surrounding transaction later rolls back (e.g. Task 1's IntegrityError
    race), the increment rolls back with it — unlike a database `SEQUENCE`,
    whose `nextval()` is never transactional and would leave a permanent gap.
    """
    seq = InvoiceNumberSequence.objects.select_for_update().get_or_create(scope=scope)[0]
    seq.last_value = seq.last_value + 1
    seq.save(update_fields=["last_value", "updated_at"])
    return f"INV-{seq.last_value:05d}"


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
                invoice_number=allocate_invoice_number(),
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
                invoice_number=allocate_invoice_number(),
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
def record_payment(
    *, invoice, amount, payment_method, received_by, reference="", shift=None,
    idempotency_key=None,
):
    """Apply a payment and keep the invoice's money fields + status in sync.

    An amount over the remaining balance is never refused (financial roadmap
    Task 7): only `invoice.balance` is applied to this invoice, and the excess
    becomes a `PatientDeposit` — a liability, held for the patient rather than
    recognised as revenue, usable on a future invoice.

    The payment is stamped with `shift` (Task 11) — or, when none is passed,
    with whatever shift `received_by` currently has open. Having no open shift
    is not an error: money is still taken, it simply reconciles against no
    drawer count.

    `idempotency_key` (optional — see `apps/billing/idempotency.py`) protects
    against a retried request creating a second `Payment` row: the ledger's
    own idempotency only protects the *posting*, which is keyed off this
    row's own pk and therefore can't help until the row already exists.
    """
    amount = Decimal(amount)
    if idempotency_key:
        fingerprint = idempotency.compute_fingerprint(
            invoice_id=invoice.pk, amount=amount,
            payment_method=payment_method, reference=reference,
        )
        existing = idempotency.claim(
            user=received_by, operation=FinancialOperation.RECORD_PAYMENT,
            key=idempotency_key, fingerprint=fingerprint,
        )
        if existing is not None:
            return Payment.objects.get(pk=existing.result_id)

    invoice = Invoice.objects.select_for_update().get(pk=invoice.pk)

    if invoice.status not in PAYABLE_STATUSES:
        raise ValidationError(
            {"invoice": f"Payments cannot be recorded on a {invoice.status} invoice."}
        )
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
        shift=_resolve_shift(shift, received_by),
    )
    entry = post_payment_received(payment, applied=applied, overpayment=overpayment)

    if overpayment:
        PatientDeposit.objects.create(
            patient=invoice.patient, amount=overpayment, journal_entry=entry,
        )

    # The ceiling is not bare `invoice.total`: a credit note or refund can
    # already have moved how much of this invoice is truly still payable
    # (financial roadmap Task 15 hardening). Capping against `total` alone
    # let `paid_amount` climb past what a corrected invoice can actually
    # absorb, driving `balance` negative once any correction existed —
    # `applied`/`overpayment` above were always correct; this is the only
    # place that wasn't. The eligible-overpayment path itself (excess ->
    # PatientDeposit) is untouched: this only bounds what counts as *applied*
    # to this invoice's own AR.
    eligible_ceiling = max(
        invoice.total - invoice.credited_amount - invoice.written_off_amount
        + invoice.refunded_amount,
        Decimal("0.00"),
    )
    invoice.paid_amount = min(
        invoice.payments.aggregate(s=Sum("amount"))["s"] or Decimal("0.00"), eligible_ceiling,
    )
    invoice.status = (
        InvoiceStatus.PAID
        if invoice.paid_amount >= invoice.total
        else InvoiceStatus.PARTIALLY_PAID
    )
    invoice.save(update_fields=["paid_amount", "status", "updated_at"])  # save() re-derives balance

    if idempotency_key:
        idempotency.complete(
            user=received_by, operation=FinancialOperation.RECORD_PAYMENT,
            key=idempotency_key, result_id=payment.id,
        )
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
def issue_credit_note(*, invoice, amount, reason_code, approved_by, idempotency_key=None):
    """Reduce what's owed on `invoice` by `amount` (full or partial — financial
    roadmap Task 7). Posts Dr revenue / Cr AR, proportionally reversing
    whatever service categories made up the invoice; the discount line (if
    any) is untouched — a credit note is relief beyond the original terms,
    not a correction of the original discount decision.

    `idempotency_key` (optional — see `apps/billing/idempotency.py`) protects
    against a retried request creating a second `CreditNote`: the ledger's
    own idempotency is keyed off this row's own pk, so it can't help until
    the row already exists.
    """
    amount = Decimal(amount)
    if idempotency_key:
        fingerprint = idempotency.compute_fingerprint(
            invoice_id=invoice.pk, amount=amount, reason_code=reason_code,
        )
        existing = idempotency.claim(
            user=approved_by, operation=FinancialOperation.ISSUE_CREDIT_NOTE,
            key=idempotency_key, fingerprint=fingerprint,
        )
        if existing is not None:
            return CreditNote.objects.get(pk=existing.result_id)

    invoice = Invoice.objects.select_for_update().get(pk=invoice.pk)
    if amount <= 0:
        raise ValidationError({"amount": "Credit note amount must be greater than zero."})
    if not reason_code:
        raise ValidationError({"reason_code": "A credit note requires a reason_code."})

    # Capped against the invoice's actual current balance, not a bare
    # total-minus-credited figure (financial roadmap Task 15 hardening): the
    # latter ignores `paid_amount`/`refunded_amount` and could credit more
    # than is genuinely still owed, driving `balance` negative. `balance` is
    # already the correct, up-to-date figure (recomputed on every save), so
    # capping against it is automatically correct for every combination of
    # prior payments/credit notes/refunds without hand-assembling the terms.
    remaining = invoice.balance
    if amount > remaining:
        raise ValidationError({
            "amount": (
                f"Credit note ({amount}) exceeds the invoice's remaining "
                f"balance ({remaining})."
            ),
        })

    require_authorization(
        actor=approved_by, amount=amount,
        threshold=Decimal(settings.FINANCE_APPROVAL_THRESHOLD_CREDIT_NOTE),
        operation_label="Issuing this credit note",
    )

    revenue_totals = _revenue_by_category(invoice)
    categories = list(revenue_totals)
    shares = _allocate_proportionally(amount, [revenue_totals[c] for c in categories])

    credit_note = CreditNote.objects.create(
        invoice=invoice, amount=amount, reason_code=reason_code, approved_by=approved_by,
        approved_by_role=approved_by.role,
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

    if idempotency_key:
        idempotency.complete(
            user=approved_by, operation=FinancialOperation.ISSUE_CREDIT_NOTE,
            key=idempotency_key, result_id=credit_note.id,
        )
    return credit_note


@transaction.atomic
def issue_refund(
    *, invoice, amount, payment_method, reason_code, approved_by,
    paid_by=None, shift=None, idempotency_key=None,
):
    """Pay back money already collected on `invoice`. Can never exceed what
    was actually collected and not already refunded (financial roadmap Task 7).

    A cash refund takes money out of the drawer, so it is stamped with the
    till session it was paid from (Task 11) and reduces that shift's expected
    cash.

    ⚠️ The drawer is resolved from `paid_by` — the person who actually handed
    the cash over — never from `approved_by`. The two are usually different
    people: a manager approves, a cashier pays. Resolving from the approver
    would charge the refund to *their* till, producing a phantom short on the
    approver's drawer and a phantom over on the one the money really left
    (`paid_by` is to a refund what `received_by` is to a payment).

    With no `paid_by` and no `shift` the refund is left unattributed rather
    than guessed at: the cashier's own close will then show a real short that
    needs explaining, which is a truthful signal — unlike quietly corrupting
    a different cashier's count.

    `idempotency_key` (optional — see `apps/billing/idempotency.py`) protects
    against a retried request creating a second `Refund`: the ledger's own
    idempotency is keyed off this row's own pk, so it can't help until the
    row already exists. This is especially important here — cash physically
    leaves a till on every cash refund.
    """
    amount = Decimal(amount)
    if idempotency_key:
        fingerprint = idempotency.compute_fingerprint(
            invoice_id=invoice.pk, amount=amount, payment_method=payment_method,
            reason_code=reason_code, paid_by_id=paid_by.id if paid_by else None,
        )
        existing = idempotency.claim(
            user=approved_by, operation=FinancialOperation.ISSUE_REFUND,
            key=idempotency_key, fingerprint=fingerprint,
        )
        if existing is not None:
            return Refund.objects.get(pk=existing.result_id)

    invoice = Invoice.objects.select_for_update().get(pk=invoice.pk)
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

    require_authorization(
        actor=approved_by, amount=amount,
        threshold=Decimal(settings.FINANCE_APPROVAL_THRESHOLD_REFUND),
        operation_label="Issuing this refund",
    )

    refund = Refund.objects.create(
        invoice=invoice, amount=amount, payment_method=payment_method,
        reason_code=reason_code, approved_by=approved_by,
        approved_by_role=approved_by.role,
        shift=_resolve_shift(shift, paid_by),
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

    if idempotency_key:
        idempotency.complete(
            user=approved_by, operation=FinancialOperation.ISSUE_REFUND,
            key=idempotency_key, result_id=refund.id,
        )
    return refund


def _recompute_written_off_amount(invoice):
    """Recompute `Invoice.written_off_amount` from its still-active
    (non-reversed) `WriteOff` rows (financial roadmap Task 15) — never
    incremented/decremented, so a `WriteOffReversal` is reflected
    automatically the next time this runs, exactly the same
    always-fresh-aggregate convention `paid_amount`/`credited_amount`/
    `refunded_amount` already use. Called from both `write_off_invoice` and
    `reverse_write_off`."""
    invoice.written_off_amount = (
        invoice.write_offs.filter(reversal__isnull=True)
        .aggregate(s=Sum("amount"))["s"] or Decimal("0.00")
    )
    invoice.save(update_fields=["written_off_amount", "updated_at"])  # save() re-derives balance


@transaction.atomic
def write_off_invoice(*, invoice, amount, reason_code, approved_by, idempotency_key=None):
    """Abandon part or all of `invoice`'s remaining balance as uncollectable
    (financial roadmap Task 15). Posts Dr `BAD_DEBT_PATIENT` / Cr `AR_PATIENT`;
    repeated partial write-offs on the same invoice are supported (each is
    its own row, capped against the invoice's current balance at the moment
    it's created).

    `idempotency_key` (optional — see `apps/billing/idempotency.py`) protects
    against a retried request creating a second `WriteOff`: the ledger's own
    idempotency is keyed off this row's own pk, so it can't help until the
    row already exists.
    """
    amount = Decimal(amount)
    if idempotency_key:
        fingerprint = idempotency.compute_fingerprint(
            invoice_id=invoice.pk, amount=amount, reason_code=reason_code,
        )
        existing = idempotency.claim(
            user=approved_by, operation=FinancialOperation.WRITE_OFF_INVOICE,
            key=idempotency_key, fingerprint=fingerprint,
        )
        if existing is not None:
            return WriteOff.objects.get(pk=existing.result_id)

    invoice = Invoice.objects.select_for_update().get(pk=invoice.pk)
    if amount <= 0:
        raise ValidationError({"amount": "Write-off amount must be greater than zero."})
    if not reason_code:
        raise ValidationError({"reason_code": "A write-off requires a reason_code."})
    if invoice.status not in PAYABLE_STATUSES:
        raise ValidationError({
            "invoice": f"An invoice in {invoice.status} status cannot be written off.",
        })

    remaining = invoice.balance
    if amount > remaining:
        raise ValidationError({
            "amount": (
                f"Write-off ({amount}) exceeds the invoice's remaining "
                f"balance ({remaining})."
            ),
        })

    require_authorization(
        actor=approved_by, amount=amount,
        threshold=Decimal(settings.FINANCE_APPROVAL_THRESHOLD_WRITE_OFF),
        operation_label="Writing off this amount",
    )

    write_off = WriteOff.objects.create(
        invoice=invoice, amount=amount, reason_code=reason_code, approved_by=approved_by,
        approved_by_role=approved_by.role,
    )
    entry = accounting_services.post(
        posting_date=timezone.localdate(),
        source_type="WriteOff",
        source_id=write_off.id,
        description=f"Write-off for {invoice.number}",
        lines=[
            {"account": AccountMap.resolve("BAD_DEBT_PATIENT"), "debit": amount},
            {
                "account": AccountMap.resolve("AR_PATIENT"), "credit": amount,
                "party_type": "Patient", "party_id": invoice.patient_id,
            },
        ],
        idempotency_key=f"WriteOff:{write_off.id}:post",
        reason_code=reason_code,
        user=approved_by,
    )
    write_off.journal_entry = entry
    write_off.save(update_fields=["journal_entry", "updated_at"])

    _recompute_written_off_amount(invoice)

    if idempotency_key:
        idempotency.complete(
            user=approved_by, operation=FinancialOperation.WRITE_OFF_INVOICE,
            key=idempotency_key, result_id=write_off.id,
        )
    return write_off


@transaction.atomic
def reverse_write_off(*, write_off, reason_code, reversed_by, idempotency_key=None):
    """Reinstate the receivable `write_off` abandoned (financial roadmap
    Task 15) — full reversal only (there is no partial-reversal concept),
    MANAGER-only regardless of amount, and at most one reversal per
    write-off (enforced both here and by `WriteOffReversal.write_off`'s
    `OneToOneField`, which is the final backstop against a race).

    The ledger reversal reuses the existing, untouched
    `accounting.services.reverse()` — the same mechanism `cancel_invoice`
    already uses — which mirrors every line of the original write-off entry
    with debit/credit swapped, automatically producing
    `Dr AR_PATIENT / Cr BAD_DEBT_PATIENT` with the same patient party. No
    bespoke reversal-posting logic is needed here.

    `idempotency_key` (optional) protects against a retried request creating
    a second `WriteOffReversal`.
    """
    if idempotency_key:
        fingerprint = idempotency.compute_fingerprint(
            write_off_id=write_off.pk, reason_code=reason_code,
        )
        existing = idempotency.claim(
            user=reversed_by, operation=FinancialOperation.REVERSE_WRITE_OFF,
            key=idempotency_key, fingerprint=fingerprint,
        )
        if existing is not None:
            return WriteOffReversal.objects.get(pk=existing.result_id)

    write_off = WriteOff.objects.select_for_update().get(pk=write_off.pk)
    if not reason_code:
        raise ValidationError({"reason_code": "A write-off reversal requires a reason_code."})
    if WriteOffReversal.objects.filter(write_off=write_off).exists():
        raise ValidationError({"write_off": "This write-off has already been reversed."})

    require_authorization(
        actor=reversed_by, threshold=None, operation_label="Reversing this write-off",
    )

    entry = None
    if write_off.journal_entry_id is not None:
        entry = accounting_services.reverse(
            write_off.journal_entry, reason_code=reason_code, user=reversed_by,
        )

    try:
        reversal = WriteOffReversal.objects.create(
            write_off=write_off, reason_code=reason_code, reversed_by=reversed_by,
            reversed_by_role=reversed_by.role, journal_entry=entry,
        )
    except IntegrityError:
        # Race: another request reversed this write-off first — the
        # OneToOneField's own unique constraint is the final backstop behind
        # the select_for_update() lock above.
        return WriteOffReversal.objects.get(write_off=write_off)

    _recompute_written_off_amount(write_off.invoice)

    if idempotency_key:
        idempotency.complete(
            user=reversed_by, operation=FinancialOperation.REVERSE_WRITE_OFF,
            key=idempotency_key, result_id=reversal.id,
        )
    return reversal


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
    if invoice.credited_amount:
        raise ValidationError({
            "invoice": "Cannot cancel an invoice with credit notes already issued.",
        })
    if invoice.written_off_amount:
        raise ValidationError({
            "invoice": "Cannot cancel an invoice with an active write-off — "
                       "reverse the write-off first.",
        })

    require_authorization(
        actor=cancelled_by, threshold=None, operation_label="Cancelling this invoice",
    )

    original_entry = JournalEntry.objects.filter(
        idempotency_key=f"Invoice:{invoice.id}:issue"
    ).first()
    if original_entry is not None:
        accounting_services.reverse(original_entry, reason_code=reason_code, user=cancelled_by)

    invoice.status = InvoiceStatus.CANCELLED
    invoice.credited_amount = invoice.total
    invoice.save(update_fields=["status", "credited_amount", "updated_at"])
    return invoice


# --- Cashier shifts (financial roadmap Task 11) --------------------------------

def current_shift(user):
    """The shift `user` currently has open, or None."""
    if user is None:
        return None
    return CashierShift.objects.filter(
        cashier=user, status=CashierShiftStatus.OPEN,
    ).first()


def _resolve_shift(shift, user):
    """The shift a payment/refund belongs to: the one passed in, or the one
    `user` has open. Money is never stamped onto an already-counted drawer —
    that would falsify a variance that has already been posted.

    The row is re-read **and locked**, not trusted off the passed instance.
    Without the lock this is a check-then-act against `close_shift`, which
    holds `select_for_update()` on the same row: read OPEN here → close_shift
    commits its count and its variance posting → this payment lands on a
    closed shift that the posted variance never accounted for. Taking the same
    lock serialises the two, so this either wins (and the close sees the
    payment) or loses (and sees CLOSED below).

    ⚠️ SQLite ignores `select_for_update()` — this guard is real on the
    PostgreSQL dev/target database only, until the production cutover.

    An explicitly passed shift that is closed is refused: the caller named a
    drawer, and it is the wrong one. When the shift was auto-resolved the
    money is simply left unstamped instead — a shift closing mid-request is
    not a reason to refuse a patient's payment (same rule as having no shift
    open at all).
    """
    named_by_caller = shift is not None
    if not named_by_caller:
        shift = current_shift(user)
        if shift is None:
            return None

    locked = CashierShift.objects.select_for_update().filter(pk=shift.pk).first()
    if locked is not None and locked.status == CashierShiftStatus.OPEN:
        return locked
    if named_by_caller:
        raise ValidationError({"shift": f"Shift #{shift.pk} is not open."})
    return None


def _post_opening_float(shift, *, user):
    """Post the shift's opening float to the ledger (financial roadmap Task
    17): "the float put into a drawer... is not posted today, so the
    ledger's cash balance differs from the drawer by any float that was
    never a patient receipt." The float is treated as drawn from the bank/
    safe into the till — the same two accounts every other cash posting in
    this module already uses, so no new chart-of-accounts entry is needed.

    Idempotent like every other posting here; a zero float posts nothing
    (the ledger refuses a zero-amount line anyway, and there is nothing to
    reconcile for a till that opened empty).
    """
    if not shift.opening_float:
        return None
    return accounting_services.post(
        posting_date=timezone.localdate(),
        source_type="CashierShift",
        source_id=shift.id,
        description=f"Opening float — shift #{shift.id} ({shift.till_id})",
        lines=[
            {"account": AccountMap.resolve("CASH_DEFAULT"), "debit": shift.opening_float},
            {"account": AccountMap.resolve("BANK_DEFAULT"), "credit": shift.opening_float},
        ],
        idempotency_key=f"CashierShift:{shift.id}:open",
        user=user,
    )


@transaction.atomic
def open_shift(*, cashier, till_id=DEFAULT_TILL_ID, opening_float=Decimal("0.00")):
    """Open a till session for `cashier`.

    One open shift per cashier and one per till, both enforced by a partial
    `UniqueConstraint`; the `IntegrityError` handler is what actually makes
    this safe under concurrency (CLAUDE.md §3 — a check-then-act without the
    constraint behind it is a bug).
    """
    opening_float = Decimal(opening_float)
    if opening_float < 0:
        raise ValidationError({"opening_float": "The opening float cannot be negative."})

    try:
        with transaction.atomic():
            shift = CashierShift.objects.create(
                cashier=cashier,
                till_id=till_id,
                opening_float=opening_float,
                currency=settings.BILLING_CURRENCY,
            )
    except IntegrityError:
        # One of the two partial unique constraints fired — say which.
        if current_shift(cashier) is not None:
            raise ValidationError(
                {"cashier": "This cashier already has an open shift — close it first."}
            )
        raise ValidationError({"till_id": f"Till {till_id} already has an open shift."})

    _post_opening_float(shift, user=cashier)
    return shift


def expected_cash(shift):
    """What the drawer should hold: opening float + cash in − cash out
    (+ mid-shift float top-ups − takings banked mid-shift, Task 17).

    Derived with `aggregate(Sum(...))` over this shift's own rows every time
    it is asked for, never kept as a running column. Only CASH payments/
    refunds count — a card or transfer never passes through the drawer.
    `CashMovement` rows are always cash by definition (that is the entire
    point of the model), so no payment-method filter applies to them.

    The opening float itself is deliberately *not* re-derived from
    `CashMovement` here — it stays the plain `shift.opening_float` column it
    always was (Task 11's own formula, untouched); only movements logged
    *during* the shift are new (Task 17) — see `CashMovement`'s docstring for
    why the two are kept separate instead of folding one into the other.
    """
    received = shift.payments.filter(
        payment_method=PaymentMethod.CASH,
    ).aggregate(s=Sum("amount"))["s"] or Decimal("0.00")
    paid_out = shift.refunds.filter(
        payment_method=PaymentMethod.CASH,
    ).aggregate(s=Sum("amount"))["s"] or Decimal("0.00")
    float_in = shift.cash_movements.filter(
        movement_type=CashMovementType.FLOAT_IN,
    ).aggregate(s=Sum("amount"))["s"] or Decimal("0.00")
    banked = shift.cash_movements.filter(
        movement_type=CashMovementType.BANK_DEPOSIT,
    ).aggregate(s=Sum("amount"))["s"] or Decimal("0.00")
    return shift.opening_float + received - paid_out + float_in - banked


def post_cash_movement(movement, *, user):
    """Post `CashMovement:{id}:post` (financial roadmap Task 17).

    `FLOAT_IN` draws cash into the till from the bank/safe (mirrors the
    opening float's own posting); `BANK_DEPOSIT` is the reverse — the day's
    takings physically leaving the till for the bank. Both move between the
    same two accounts `_post_opening_float`/`post_payment_received` already
    use, so no new chart-of-accounts entry was needed for this task.
    """
    cash_account = AccountMap.resolve("CASH_DEFAULT")
    bank_account = AccountMap.resolve("BANK_DEFAULT")
    if movement.movement_type == CashMovementType.FLOAT_IN:
        lines = [
            {"account": cash_account, "debit": movement.amount},
            {"account": bank_account, "credit": movement.amount},
        ]
    else:
        lines = [
            {"account": bank_account, "debit": movement.amount},
            {"account": cash_account, "credit": movement.amount},
        ]

    return accounting_services.post(
        posting_date=timezone.localdate(),
        source_type="CashMovement",
        source_id=movement.id,
        description=(
            f"{movement.get_movement_type_display()} — shift #{movement.shift_id}"
        ),
        lines=lines,
        idempotency_key=f"CashMovement:{movement.id}:post",
        user=user,
    )


@transaction.atomic
def record_cash_movement(
    *, shift, movement_type, amount, reason, created_by, idempotency_key=None,
):
    """Log and post a mid-shift cash movement (financial roadmap Task 17) —
    a float top-up or a bank deposit against an *open* shift. Refused on a
    closed shift for the same reason `_resolve_shift` refuses a payment onto
    one: a closed shift's `expected_cash` was already counted and posted, and
    this would silently change a figure that has already been reconciled.

    `idempotency_key` (optional — see `apps/billing/idempotency.py`) protects
    against a retried request creating a second `CashMovement`: the ledger's
    own idempotency is keyed off this row's own pk, so it can't help until
    the row already exists. Especially important here — a duplicate
    FLOAT_IN/BANK_DEPOSIT would corrupt physical cash reconciliation.
    """
    amount = Decimal(amount)
    if idempotency_key:
        fingerprint = idempotency.compute_fingerprint(
            shift_id=shift.pk, movement_type=movement_type, amount=amount, reason=reason,
        )
        existing = idempotency.claim(
            user=created_by, operation=FinancialOperation.RECORD_CASH_MOVEMENT,
            key=idempotency_key, fingerprint=fingerprint,
        )
        if existing is not None:
            return CashMovement.objects.get(pk=existing.result_id)

    shift = CashierShift.objects.select_for_update().get(pk=shift.pk)
    if shift.status != CashierShiftStatus.OPEN:
        raise ValidationError({"shift": f"Shift #{shift.pk} is not open."})

    if amount <= 0:
        raise ValidationError({"amount": "The amount must be greater than zero."})
    if not reason:
        raise ValidationError({"reason": "A cash movement requires a reason."})

    movement = CashMovement.objects.create(
        shift=shift, movement_type=movement_type, amount=amount,
        reason=reason, created_by=created_by,
    )
    entry = post_cash_movement(movement, user=created_by)
    movement.journal_entry = entry
    movement.save(update_fields=["journal_entry", "updated_at"])

    if idempotency_key:
        idempotency.complete(
            user=created_by, operation=FinancialOperation.RECORD_CASH_MOVEMENT,
            key=idempotency_key, result_id=movement.id,
        )
    return movement


def post_shift_variance(shift, *, variance, reason_code, user, posting_date=None):
    """Post `Shift:{id}:variance` — the till over/short (financial roadmap
    Task 11; `clinic-accounting-events.md`§3 `CashierShiftClosed`).

    The counted drawer is the truth, so the cash account is moved to match it
    and `CASH_VARIANCE` absorbs the difference:

    - over  (counted > expected): Dr cash        / Cr cash variance
    - short (counted < expected): Dr cash variance / Cr cash

    The cash side is `CASH_DEFAULT` — the same account `post_payment_received`
    debits for a cash receipt, so the variance lands where the cash it explains
    actually sits. A zero variance posts nothing and returns None: there is no
    entry to make, and the ledger refuses a zero-amount line anyway.
    """
    if not variance:
        return None
    if not reason_code:
        raise ValidationError(
            {"reason_code": "A till variance requires a reason_code."}
        )

    cash_account = AccountMap.resolve("CASH_DEFAULT")
    variance_account = AccountMap.resolve("CASH_VARIANCE")
    amount = abs(variance)
    if variance > 0:
        lines = [
            {"account": cash_account, "debit": amount},
            {"account": variance_account, "credit": amount},
        ]
    else:
        lines = [
            {"account": variance_account, "debit": amount},
            {"account": cash_account, "credit": amount},
        ]

    return accounting_services.post(
        posting_date=posting_date or timezone.localdate(),
        source_type="CashierShift",
        source_id=shift.id,
        description=f"Till variance — shift #{shift.id} ({shift.till_id})",
        lines=lines,
        idempotency_key=f"Shift:{shift.id}:variance",
        reason_code=reason_code,
        user=user,
    )


@transaction.atomic
def close_shift(*, shift, counted_amount, closed_by, reason_code="", notes=""):
    """Count the drawer, post the difference, and close the shift for good.

    `counted_amount` is what was physically counted. Anything other than the
    expected figure is a financial correction, so it needs a `reason_code` —
    refused here, and refused again by the database
    (`shift_variance_requires_reason_and_approval`).

    Authorization (financial roadmap Task 15) is decided *inside* this
    function, against the freshly-locked shift's own `abs(variance)` — not by
    the caller pre-computing it and handing in an `approved_by`. That closed
    a real bypass: nothing previously stopped a direct call from setting
    `approved_by` to a non-manager for an arbitrarily large variance. There is
    no separate approver identity in this model: whoever closes the shift
    *is* the approver whenever there's a variance to approve (`closed_by` and
    `approved_by` are always the same person here), so this function no
    longer takes `approved_by` as a parameter at all.

    Returns the closed shift; `shift.journal_entry` is the variance posting, or
    None when the count came out exactly right.
    """
    shift = CashierShift.objects.select_for_update().get(pk=shift.pk)
    if shift.status != CashierShiftStatus.OPEN:
        raise ValidationError({"shift": f"Shift #{shift.pk} is already closed."})

    counted_amount = Decimal(counted_amount)
    if counted_amount < 0:
        raise ValidationError({"counted_amount": "The counted amount cannot be negative."})

    expected = expected_cash(shift)
    variance = counted_amount - expected
    if variance:
        if not reason_code:
            raise ValidationError({
                "reason_code": (
                    f"The drawer is {'over' if variance > 0 else 'short'} by "
                    f"{abs(variance)} — closing with a variance requires a reason_code."
                ),
            })
        require_authorization(
            actor=closed_by, amount=abs(variance),
            threshold=Decimal(settings.FINANCE_APPROVAL_THRESHOLD_CASHIER_VARIANCE),
            operation_label="Closing this shift with a variance",
        )

    approved_by = closed_by if variance else None
    entry = post_shift_variance(
        shift, variance=variance, reason_code=reason_code, user=approved_by,
    )

    shift.status = CashierShiftStatus.CLOSED
    shift.closed_at = timezone.now()
    shift.closed_by = closed_by
    shift.closed_by_role = closed_by.role
    shift.expected_amount = expected
    shift.counted_amount = counted_amount
    shift.variance = variance
    shift.variance_reason_code = reason_code if variance else ""
    shift.approved_by = approved_by
    shift.journal_entry = entry
    shift.notes = notes
    shift.save(update_fields=[
        "status", "closed_at", "closed_by", "closed_by_role", "expected_amount",
        "counted_amount", "variance", "variance_reason_code", "approved_by",
        "journal_entry", "notes", "updated_at",
    ])
    return shift


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
