"""Billing module (Phase 12) — pricing catalog, invoices, payments, fee validity.

Money flow: completing an appointment issues an `Invoice` built from the
`ServiceItem` catalog; the secretary records `Payment` rows against it, and the
invoice keeps `paid_amount`/`balance`/`status` in sync. A fully-paid consultation
opens a `FeeValidity` window during which follow-up visits with the same doctor
are free (used_count is incremented instead of issuing a new invoice).

All FKs point at `users.User` (not the profile models): the patient/doctor split
is role-based here, and object-level API permissions filter on `request.user`.
"""
from decimal import Decimal

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models

from apps.core.enums import (
    BillingSourceType,
    InvoiceStatus,
    PaymentMethod,
    ServiceItemType,
)
from apps.core.models import TimeStampedModel


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
    # Always derived: never written directly, recomputed on every save().
    balance = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))
    currency = models.CharField(max_length=8, default="USD")
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["-invoice_date", "-id"]
        indexes = [
            models.Index(fields=["patient", "status"]),
            models.Index(fields=["doctor", "invoice_date"]),
            models.Index(fields=["status", "invoice_date"]),
        ]

    def __str__(self):
        return f"{self.number} — {self.patient} ({self.status})"

    @property
    def number(self):
        """Display number, e.g. INV-00042 (derived from pk, no extra column)."""
        return f"INV-{self.pk:05d}" if self.pk else "INV-(unsaved)"

    def save(self, *args, **kwargs):
        self.balance = (self.total or Decimal("0.00")) - (self.paid_amount or Decimal("0.00"))
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

    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name="items")
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

    class Meta:
        ordering = ["-paid_at"]

    def __str__(self):
        return f"{self.amount} {self.payment_method} on {self.invoice}"


class FeeValidity(TimeStampedModel):
    """Free follow-up window opened when a consultation invoice is fully paid.

    While today is inside [valid_from, valid_until] and used_count is below
    max_free_visits, completing an appointment with the same (patient, doctor)
    pair increments used_count instead of issuing a new invoice.
    """

    patient = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="fee_validities"
    )
    doctor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name="doctor_fee_validities",
    )
    invoice = models.ForeignKey(
        Invoice, on_delete=models.CASCADE, related_name="fee_validities"
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
