"""Billing module (Phase 12) — pricing catalog, invoices, payments, fee validity.
Financial roadmap Tasks 6-7 wire this into the double-entry ledger in
apps.accounting: `CreditNote`/`Refund`/`PatientDeposit` plus invoice
cancellation.

`CashierShift` (Task 11) is the till session money is received into: a
payment/refund taken while its cashier has a shift open is stamped with it,
and closing the shift posts the difference between the counted drawer and
what the ledger expects.

Money flow: completing an appointment issues an `Invoice` built from the
`ServiceItem` catalog; the secretary records `Payment` rows against it, and the
invoice keeps `paid_amount`/`balance`/`status` in sync. A consultation invoice
opens a `FeeValidity` window *when issued* (not when paid — see the class
docstring) during which follow-up visits with the same doctor are free
(used_count is incremented instead of issuing a new invoice).

All FKs point at `users.User` (not the profile models): the patient/doctor split
is role-based here, and object-level API permissions filter on `request.user`.
"""
from decimal import Decimal

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models
from django.utils import timezone

from apps.core.enums import (
    BillingSourceType,
    CashierShiftStatus,
    DepositStatus,
    InvoiceStatus,
    PaymentMethod,
    ServiceItemType,
)
from apps.core.models import TimeStampedModel

from .exceptions import ClosedShiftError, InvoiceNumberImmutableError


class ServiceItem(TimeStampedModel):
    """Pricing catalog entry, e.g. "General Consultation" / "كشف عام"."""

    name = models.CharField(max_length=200)
    name_ar = models.CharField(max_length=200, blank=True)
    item_type = models.CharField(
        max_length=20, choices=ServiceItemType.choices, default=ServiceItemType.OTHER,
        db_index=True,
    )
    default_price = models.DecimalField(
        max_digits=10, decimal_places=2,
        validators=[MinValueValidator(Decimal("0.00"))],
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return f"{self.name} ({self.default_price})"


class InvoiceNumberSequence(TimeStampedModel):
    """A transaction-safe, gapless counter for `Invoice.invoice_number`
    (financial roadmap Task 14).

    Deliberately *not* a Postgres `SEQUENCE`: `nextval()` is non-transactional
    — a rolled-back transaction still consumes the value it drew, leaving a
    permanent gap, which is exactly what a gapless requirement forbids. This
    row is incremented with `select_for_update()` inside the *same*
    `transaction.atomic()` block that creates the `Invoice` (see
    `services._allocate_invoice_number`), so a rollback (e.g. the Task-1
    duplicate-billing race) undoes the increment along with everything else —
    the number is never actually consumed unless the invoice it belongs to is.

    `scope` exists so a future need for more than one independent sequence
    (e.g. per branch) doesn't require a schema change — not used today, and
    the roadmap doesn't ask for branch/year dimensions, so every invoice
    currently allocates from the single `"default"` scope.
    """

    scope = models.CharField(max_length=32, unique=True, default="default")
    last_value = models.PositiveIntegerField(default=0)

    def __str__(self):
        return f"{self.scope} @ {self.last_value}"


class Invoice(TimeStampedModel):
    """Main billing document for a patient visit (or ad-hoc charges)."""

    patient = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="invoices"
    )
    doctor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="doctor_invoices",
    )
    invoice_date = models.DateField(auto_now_add=True)
    due_date = models.DateField(null=True, blank=True)
    status = models.CharField(
        max_length=16, choices=InvoiceStatus.choices, default=InvoiceStatus.DRAFT,
        db_index=True,
    )
    subtotal = models.DecimalField(
        max_digits=10, decimal_places=2, default=Decimal("0.00"),
        validators=[MinValueValidator(Decimal("0.00"))],
    )
    discount = models.DecimalField(
        max_digits=10, decimal_places=2, default=Decimal("0.00"),
        validators=[MinValueValidator(Decimal("0.00"))],
    )
    total = models.DecimalField(
        max_digits=10, decimal_places=2, default=Decimal("0.00"),
        validators=[MinValueValidator(Decimal("0.00"))],
    )
    paid_amount = models.DecimalField(
        max_digits=10, decimal_places=2, default=Decimal("0.00"),
        validators=[MinValueValidator(Decimal("0.00"))],
    )
    # Both derived from Sum() over this invoice's CreditNote/Refund rows
    # (Task 7) — never incremented with `+=`, same convention as paid_amount.
    credited_amount = models.DecimalField(
        max_digits=10, decimal_places=2, default=Decimal("0.00"),
        validators=[MinValueValidator(Decimal("0.00"))],
    )
    refunded_amount = models.DecimalField(
        max_digits=10, decimal_places=2, default=Decimal("0.00"),
        validators=[MinValueValidator(Decimal("0.00"))],
    )
    # Always derived: never written directly, recomputed on every save().
    balance = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))
    currency = models.CharField(max_length=8, default="EGP")
    notes = models.TextField(blank=True)
    # A real, gapless, immutable sequence number (financial roadmap Task 14) —
    # allocated by services._allocate_invoice_number() at creation time, never
    # here. Blank (not null) for the same reason InvoiceItem's source_id
    # partial-unique constraint uses a condition rather than nullable+unique:
    # it matches this codebase's existing convention for "unique unless
    # blank". Every invoice created through the service layer gets one;
    # historical rows from before Task 14 were backfilled in migration 0010
    # with their existing pk-derived display number, so nothing already shown
    # to a patient/printed on a receipt ever changes.
    invoice_number = models.CharField(max_length=20, blank=True, default="")

    class Meta:
        ordering = ["-invoice_date", "-id"]
        indexes = [
            models.Index(fields=["patient", "status"]),
            models.Index(fields=["doctor", "invoice_date"]),
            models.Index(fields=["status", "invoice_date"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["invoice_number"],
                condition=~models.Q(invoice_number=""),
                name="uniq_invoice_number",
            ),
        ]

    def __str__(self):
        return f"{self.number} — {self.patient} ({self.status})"

    @property
    def number(self):
        """Display number: the real allocated sequence (`invoice_number`) once
        set, else the old pk-derived fallback for rows that predate Task 14
        or were created outside the normal service layer (e.g. in a shell)."""
        return self.invoice_number or (f"INV-{self.pk:05d}" if self.pk else "INV-(unsaved)")

    def save(self, *args, **kwargs):
        if self.pk:
            previous_number = (
                Invoice.objects.filter(pk=self.pk)
                .values_list("invoice_number", flat=True)
                .first()
            )
            if previous_number and self.invoice_number != previous_number:
                raise InvoiceNumberImmutableError(
                    f"Invoice #{self.pk}'s number ({previous_number}) is immutable — "
                    f"attempted to change it to {self.invoice_number!r}."
                )
        # A credit note reduces what's owed; a refund of already-collected
        # money increases it again. Neither ever rewrites `total`/`paid_amount`
        # — those stay the historical record of what was billed and collected.
        self.balance = (
            (self.total or Decimal("0.00"))
            - (self.paid_amount or Decimal("0.00"))
            - (self.credited_amount or Decimal("0.00"))
            + (self.refunded_amount or Decimal("0.00"))
        )
        if "update_fields" in kwargs and kwargs["update_fields"] is not None:
            kwargs["update_fields"] = list(set(kwargs["update_fields"]) | {"balance"})
        super().save(*args, **kwargs)

    def recalculate_totals(self, save=True):
        """Re-derive subtotal/total from line items (call after items change)."""
        self.subtotal = sum(
            (item.line_total for item in self.items.all()), Decimal("0.00")
        )
        self.total = self.subtotal - (self.discount or Decimal("0.00"))
        if save:
            self.save(update_fields=["subtotal", "total", "updated_at"])
        return self.total


class InvoiceItem(TimeStampedModel):
    """A single billed line on an invoice."""

    # PROTECT, not CASCADE (CLAUDE.md's "PROTECT on every financial FK"): an
    # invoice is never hard-deleted (cancel-only, see services.cancel_invoice),
    # and a stray `Invoice.delete()` must not be able to silently take its
    # billed line items — a financial detail record — down with it.
    invoice = models.ForeignKey(Invoice, on_delete=models.PROTECT, related_name="items")
    description = models.CharField(max_length=255)
    service_item = models.ForeignKey(
        ServiceItem, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="invoice_items",
    )
    quantity = models.PositiveIntegerField(default=1)
    unit_price = models.DecimalField(
        max_digits=10, decimal_places=2,
        validators=[MinValueValidator(Decimal("0.00"))],
    )
    # Always derived: quantity * unit_price, recomputed on every save().
    line_total = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))
    source_type = models.CharField(
        max_length=20, choices=BillingSourceType.choices,
        default=BillingSourceType.APPOINTMENT,
    )
    source_id = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        ordering = ["id"]
        constraints = [
            models.UniqueConstraint(
                fields=["source_type", "source_id"],
                condition=models.Q(source_id__isnull=False),
                name="uniq_invoice_item_source",
            ),
        ]

    def __str__(self):
        return f"{self.description} x{self.quantity} = {self.line_total}"

    def save(self, *args, **kwargs):
        self.line_total = (self.unit_price or Decimal("0.00")) * self.quantity
        if "update_fields" in kwargs and kwargs["update_fields"] is not None:
            kwargs["update_fields"] = list(set(kwargs["update_fields"]) | {"line_total"})
        super().save(*args, **kwargs)


class Payment(TimeStampedModel):
    """A money-received transaction against an invoice."""

    invoice = models.ForeignKey(Invoice, on_delete=models.PROTECT, related_name="payments")
    paid_at = models.DateTimeField(auto_now_add=True)
    amount = models.DecimalField(
        max_digits=10, decimal_places=2,
        validators=[MinValueValidator(Decimal("0.01"))],
    )
    payment_method = models.CharField(
        max_length=16, choices=PaymentMethod.choices, default=PaymentMethod.CASH
    )
    reference = models.CharField(max_length=100, blank=True)
    received_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="received_payments",
    )
    # The till session this money was taken in (Task 11). Null when the
    # cashier had no shift open — a shift is a reconciliation aid, never a
    # precondition for taking a patient's money.
    shift = models.ForeignKey(
        "billing.CashierShift", null=True, blank=True, on_delete=models.PROTECT,
        related_name="payments",
    )

    class Meta:
        ordering = ["-paid_at"]

    def __str__(self):
        return f"{self.amount} {self.payment_method} on {self.invoice}"


class FeeValidity(TimeStampedModel):
    """Free follow-up window opened when a consultation invoice is *issued*.

    The consultation fee buys an episode of care (visit + follow-ups within
    BILLING_FOLLOWUP_DAYS), so the entitlement is created by the sale, not by
    the collection. Whether the invoice is paid is a receivables concern —
    see the arrears check in `handle_appointment_completed`.

    While today is inside [valid_from, valid_until] and used_count is below
    max_free_visits, completing an appointment with the same (patient, doctor)
    pair increments used_count instead of issuing a new invoice.
    """

    # PROTECT, not CASCADE, on all three (CLAUDE.md's "PROTECT on every
    # financial FK") — a free-follow-up entitlement is itself a financial
    # record (it represents value given away, see the roadmap's optional
    # ENTITLEMENT_FORGONE ledger line), so losing it as a side effect of
    # deleting a patient/doctor/invoice row would silently erase that history.
    # In practice `patient`/`doctor` are already unreachable here — Invoice.patient
    # is PROTECT, so a patient with a FeeValidity can never be deleted anyway —
    # but that must not depend on `invoice` always being required; PROTECT
    # everywhere is the one invariant that stays true on its own.
    patient = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="fee_validities"
    )
    doctor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
        related_name="doctor_fee_validities",
    )
    invoice = models.ForeignKey(
        Invoice, on_delete=models.PROTECT, related_name="fee_validities"
    )
    valid_from = models.DateField()
    valid_until = models.DateField()
    used_count = models.PositiveIntegerField(default=0)
    max_free_visits = models.PositiveIntegerField(default=1)

    class Meta:
        ordering = ["-valid_until"]
        verbose_name_plural = "Fee validities"
        indexes = [
            models.Index(fields=["patient", "doctor", "valid_until"]),
        ]

    def __str__(self):
        return (
            f"FeeValidity {self.patient} → {self.doctor} "
            f"[{self.valid_from} → {self.valid_until}] ({self.used_count}/{self.max_free_visits})"
        )

    def covers(self, date):
        """True if `date` is inside the window and free visits remain."""
        return (
            self.valid_from <= date <= self.valid_until
            and self.used_count < self.max_free_visits
        )


class CreditNote(TimeStampedModel):
    """Reduces what a patient owes on `invoice` without editing its totals.

    Posts its own ledger entry (Dr revenue / Cr AR) — a pure revenue-and-AR
    adjustment, separate from whatever discount was applied at issue time.
    `journal_entry` is nullable only because the ledger entry's idempotency
    key needs this row's own pk first; `services.issue_credit_note` always
    fills it in before returning, in the same transaction.
    """

    invoice = models.ForeignKey(Invoice, on_delete=models.PROTECT, related_name="credit_notes")
    amount = models.DecimalField(
        max_digits=10, decimal_places=2, validators=[MinValueValidator(Decimal("0.01"))],
    )
    reason_code = models.CharField(max_length=64)
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="approved_credit_notes",
    )
    journal_entry = models.ForeignKey(
        "accounting.JournalEntry", null=True, blank=True,
        on_delete=models.PROTECT, related_name="+",
    )

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(
                condition=~models.Q(reason_code=""), name="creditnote_reason_code_required",
            ),
        ]

    def __str__(self):
        return f"CreditNote {self.amount} on {self.invoice.number}"


class Refund(TimeStampedModel):
    """Money paid back to a patient against `invoice`. Can never exceed what
    was actually collected on that invoice (enforced in `services.issue_refund`).
    """

    invoice = models.ForeignKey(Invoice, on_delete=models.PROTECT, related_name="refunds")
    amount = models.DecimalField(
        max_digits=10, decimal_places=2, validators=[MinValueValidator(Decimal("0.01"))],
    )
    payment_method = models.CharField(max_length=16, choices=PaymentMethod.choices)
    reason_code = models.CharField(max_length=64)
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="approved_refunds",
    )
    # The till session the money was paid out of (Task 11) — a cash refund
    # takes money *out* of the drawer, so it counts against expected cash.
    shift = models.ForeignKey(
        "billing.CashierShift", null=True, blank=True, on_delete=models.PROTECT,
        related_name="refunds",
    )
    journal_entry = models.ForeignKey(
        "accounting.JournalEntry", null=True, blank=True,
        on_delete=models.PROTECT, related_name="+",
    )

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(
                condition=~models.Q(reason_code=""), name="refund_reason_code_required",
            ),
        ]

    def __str__(self):
        return f"Refund {self.amount} on {self.invoice.number}"


class PatientDeposit(TimeStampedModel):
    """Money held for a patient that isn't revenue yet — an overpayment (Task 7)
    or an advance taken before treatment. Posted to a liability account, never
    to revenue; `available_amount` is what's left to apply or refund.
    """

    patient = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="deposits",
    )
    amount = models.DecimalField(
        max_digits=10, decimal_places=2, validators=[MinValueValidator(Decimal("0.01"))],
    )
    applied_amount = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))
    refunded_amount = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))
    status = models.CharField(
        max_length=20, choices=DepositStatus.choices, default=DepositStatus.HELD,
    )
    journal_entry = models.ForeignKey(
        "accounting.JournalEntry", null=True, blank=True,
        on_delete=models.PROTECT, related_name="+",
    )

    class Meta:
        ordering = ["-created_at"]

    @property
    def available_amount(self):
        return self.amount - self.applied_amount - self.refunded_amount

    def __str__(self):
        return f"Deposit {self.amount} for {self.patient} ({self.status})"


DEFAULT_TILL_ID = "MAIN"


class CashierShift(TimeStampedModel):
    """One cashier's session at one till (financial roadmap Task 11).

    Opening records the float already in the drawer; every cash payment taken
    and every cash refund paid out while the shift is open is stamped with it
    (see `services.record_payment` / `services.issue_refund`). Closing counts
    the drawer and **posts** the difference — `services.close_shift`, never a
    direct write here.

    `expected_amount` is always derived at close time with `aggregate(Sum(...))`
    over this shift's own payment/refund rows (`services.expected_cash`), never
    kept as a running counter; the three money columns are the frozen record of
    what that one count found.

    ⚠️ `variance = counted_amount - expected_amount`, so it is signed: positive
    is an *over* (more cash in the drawer than the ledger says), negative a
    *short*. Both are posted against `CASH_VARIANCE`, in opposite directions.

    A non-zero variance is a financial correction, so it requires a
    `variance_reason_code` and an `approved_by` — enforced at the database
    level by `shift_variance_requires_reason_and_approval`, not only in the
    service. Once CLOSED the row is immutable (`save()`/`delete()` raise):
    a mistaken count is corrected by a reversing journal entry, exactly like
    every other financial record in this system.
    """

    cashier = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="cashier_shifts",
    )
    # A label for the physical drawer, not an account selector: every till
    # currently posts to the same `CASH_DEFAULT` account that
    # `post_payment_received` debits, so a variance always lands on the account
    # the cash actually sits in. Per-till cash accounts (`CASH_BY_TILL`) would
    # need the receipt posting to split first — not this task.
    till_id = models.CharField(max_length=32, default=DEFAULT_TILL_ID, db_index=True)
    status = models.CharField(
        max_length=8, choices=CashierShiftStatus.choices, default=CashierShiftStatus.OPEN,
        db_index=True,
    )
    opened_at = models.DateTimeField(default=timezone.now)
    closed_at = models.DateTimeField(null=True, blank=True)
    closed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT,
        related_name="closed_cashier_shifts",
    )
    opening_float = models.DecimalField(
        max_digits=10, decimal_places=2, default=Decimal("0.00"),
        validators=[MinValueValidator(Decimal("0.00"))],
    )
    # All three set together at close; null while the shift is open.
    expected_amount = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True,
    )
    counted_amount = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True,
        validators=[MinValueValidator(Decimal("0.00"))],
    )
    # Signed: counted - expected. No MinValueValidator — a short is negative.
    variance = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    variance_reason_code = models.CharField(max_length=64, blank=True, default="")
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT,
        related_name="approved_shift_variances",
    )
    journal_entry = models.ForeignKey(
        "accounting.JournalEntry", null=True, blank=True,
        on_delete=models.PROTECT, related_name="+",
    )
    currency = models.CharField(max_length=8, default="EGP")
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["-opened_at", "-id"]
        indexes = [
            models.Index(fields=["cashier", "status"]),
            models.Index(fields=["status", "opened_at"]),
        ]
        constraints = [
            # Check-then-act needs a database constraint behind it (CLAUDE.md
            # §3): two requests must not be able to open a second shift on the
            # same drawer, or for the same cashier, at the same moment.
            models.UniqueConstraint(
                fields=["cashier"], condition=models.Q(status=CashierShiftStatus.OPEN),
                name="uniq_open_shift_per_cashier",
            ),
            models.UniqueConstraint(
                fields=["till_id"], condition=models.Q(status=CashierShiftStatus.OPEN),
                name="uniq_open_shift_per_till",
            ),
            models.CheckConstraint(
                condition=models.Q(opening_float__gte=Decimal("0.00")),
                name="shift_opening_float_non_negative",
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(counted_amount__isnull=True)
                    | models.Q(counted_amount__gte=Decimal("0.00"))
                ),
                name="shift_counted_amount_non_negative",
            ),
            # A financial correction always carries a reason and an approver.
            models.CheckConstraint(
                condition=(
                    models.Q(variance__isnull=True)
                    | models.Q(variance=Decimal("0.00"))
                    | (
                        ~models.Q(variance_reason_code="")
                        & models.Q(approved_by__isnull=False)
                    )
                ),
                name="shift_variance_requires_reason_and_approval",
            ),
            # A closed shift is a complete count: never half-filled.
            models.CheckConstraint(
                condition=(
                    ~models.Q(status=CashierShiftStatus.CLOSED)
                    | (
                        models.Q(closed_at__isnull=False)
                        & models.Q(expected_amount__isnull=False)
                        & models.Q(counted_amount__isnull=False)
                        & models.Q(variance__isnull=False)
                    )
                ),
                name="closed_shift_is_complete",
            ),
        ]

    def __str__(self):
        return f"Shift #{self.pk} {self.till_id} ({self.cashier}) — {self.status}"

    @property
    def is_open(self):
        return self.status == CashierShiftStatus.OPEN

    def save(self, *args, **kwargs):
        if self.pk:
            previous_status = (
                CashierShift.objects.filter(pk=self.pk)
                .values_list("status", flat=True)
                .first()
            )
            if previous_status == CashierShiftStatus.CLOSED:
                raise ClosedShiftError(
                    f"Shift #{self.pk} is closed — post a correcting journal entry "
                    f"instead of editing it."
                )
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ClosedShiftError("cashier shifts cannot be deleted")
