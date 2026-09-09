"""Accounting core (financial roadmap Task 4) — chart of accounts and periods.

`Account` is a tree via a self-FK; only leaves (`is_group=False`) are ever
postable. `AccountMap` is the one place code may ask "which account handles
X" — callers resolve by *purpose*, never by hard-coded account code, and
`resolve()` raises rather than silently returning nothing. `FiscalYear` and
`Period` give every future posting a period to resolve against; periods are
enforced non-overlapping across the whole ledger (not just within one fiscal
year), since a posting date must resolve to exactly one period.

`JournalEntry`/`JournalLine` (Task 5) are the ledger itself: a balanced,
immutable posting. Nothing outside `apps.accounting.services.post()` may
construct one directly — that is the ledger's one door. Corrections are
always a new, reversing entry (`services.reverse()`), never an edit.

Immutability is enforced twice: `save()`/`delete()` raise in Python for the
common case (an ORM call on a model instance), and a Postgres trigger
(migration 0002) rejects UPDATE/DELETE at the database level for the case
Python can't see — a bulk `.update()`/`.delete()` on a queryset, which never
calls an instance's overridden methods.
"""
from decimal import Decimal

from django.conf import settings
from django.db import models

from apps.core.enums import AccountType, FiscalYearStatus, PeriodStatus, ReportSection, RootType
from apps.core.models import TimeStampedModel

from .exceptions import (
    GroupAccountNotPostableError,
    ImmutableAccountCodeError,
    ImmutableLedgerError,
    InactiveAccountError,
    OverlappingPeriodError,
    UnmappedPurposeError,
)

_BALANCE_SHEET_ROOTS = (RootType.ASSET, RootType.LIABILITY, RootType.EQUITY)


class Account(TimeStampedModel):
    """A node in the chart of accounts."""

    code = models.CharField(max_length=20)
    name = models.CharField(max_length=200)
    name_ar = models.CharField(max_length=200, blank=True)
    parent = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.PROTECT, related_name="children",
    )
    root_type = models.CharField(max_length=12, choices=RootType.choices, db_index=True)
    account_type = models.CharField(
        max_length=32, choices=AccountType.choices, blank=True, db_index=True,
    )
    is_group = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    currency = models.CharField(max_length=8, default="EGP")

    class Meta:
        ordering = ["code"]
        constraints = [
            models.UniqueConstraint(fields=["code"], name="uniq_account_code"),
        ]

    def __str__(self):
        return f"{self.code} {self.name}"

    @property
    def report_section(self):
        """Which statement this account's root_type feeds: balance sheet or P&L."""
        return (
            ReportSection.BALANCE_SHEET
            if self.root_type in _BALANCE_SHEET_ROOTS
            else ReportSection.PROFIT_AND_LOSS
        )

    def assert_postable(self):
        """Raise if this account may never receive a journal line.

        Called by Task 5's posting pipeline; kept on the model itself so any
        other caller (reports, admin actions) can ask the same question.
        """
        if self.is_group:
            raise GroupAccountNotPostableError(
                f"{self.code} {self.name} is a group account and cannot be posted to."
            )
        if not self.is_active:
            raise InactiveAccountError(f"{self.code} {self.name} is inactive.")

    def _is_used(self):
        """True once anything depends on this account's code meaning what it says:
        mapped for a purpose, or already posted to."""
        if AccountMap.objects.filter(account=self).exists():
            return True
        return self.journal_lines.exists()

    def save(self, *args, **kwargs):
        if self.pk:
            previous_code = (
                Account.objects.filter(pk=self.pk).values_list("code", flat=True).first()
            )
            if previous_code is not None and previous_code != self.code and self._is_used():
                raise ImmutableAccountCodeError(
                    f"Account {previous_code} is in use — its code cannot be changed "
                    f"(attempted to rename it to {self.code})."
                )
        super().save(*args, **kwargs)


class AccountMap(TimeStampedModel):
    """purpose → account. Code asks by purpose, never by account code."""

    purpose = models.CharField(max_length=64, db_index=True)
    qualifier = models.CharField(max_length=64, blank=True, default="")
    account = models.ForeignKey(
        Account, on_delete=models.PROTECT, related_name="account_map_entries",
    )

    class Meta:
        ordering = ["purpose", "qualifier"]
        verbose_name = "Account map entry"
        verbose_name_plural = "Account map entries"
        constraints = [
            models.UniqueConstraint(fields=["purpose", "qualifier"], name="uniq_account_map"),
        ]

    def __str__(self):
        qualifier = f":{self.qualifier}" if self.qualifier else ""
        return f"{self.purpose}{qualifier} -> {self.account.code}"

    @classmethod
    def resolve(cls, purpose, qualifier=""):
        """Return the mapped `Account` for `purpose`(+`qualifier`); raise, never None."""
        try:
            return (
                cls.objects.select_related("account")
                .get(purpose=purpose, qualifier=qualifier)
                .account
            )
        except cls.DoesNotExist:
            raise UnmappedPurposeError(
                f"No account is mapped for purpose={purpose!r} qualifier={qualifier!r}."
            ) from None


class FiscalYear(TimeStampedModel):
    name = models.CharField(max_length=32, unique=True)
    start_date = models.DateField()
    end_date = models.DateField()
    status = models.CharField(
        max_length=8, choices=FiscalYearStatus.choices, default=FiscalYearStatus.OPEN,
    )

    class Meta:
        ordering = ["-start_date"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(end_date__gt=models.F("start_date")),
                name="fiscal_year_end_after_start",
            ),
        ]

    def __str__(self):
        return self.name


class Period(TimeStampedModel):
    fiscal_year = models.ForeignKey(FiscalYear, on_delete=models.PROTECT, related_name="periods")
    name = models.CharField(max_length=32, blank=True)
    start_date = models.DateField()
    end_date = models.DateField()
    status = models.CharField(
        max_length=12, choices=PeriodStatus.choices, default=PeriodStatus.OPEN,
    )

    class Meta:
        ordering = ["start_date"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(end_date__gt=models.F("start_date")),
                name="period_end_after_start",
            ),
        ]

    def __str__(self):
        return self.name or f"{self.start_date} – {self.end_date}"

    def _overlaps_existing(self):
        return (
            Period.objects.filter(start_date__lte=self.end_date, end_date__gte=self.start_date)
            .exclude(pk=self.pk)
            .exists()
        )

    def save(self, *args, **kwargs):
        if self._overlaps_existing():
            raise OverlappingPeriodError(
                f"Period {self.start_date} – {self.end_date} overlaps an existing period."
            )
        super().save(*args, **kwargs)

    @classmethod
    def for_date(cls, a_date):
        """The single period `a_date` falls in, or None."""
        return cls.objects.filter(start_date__lte=a_date, end_date__gte=a_date).first()


class JournalEntry(TimeStampedModel):
    """A balanced, immutable posting. Written only by `services.post()`."""

    posting_date = models.DateField(db_index=True)
    period = models.ForeignKey(Period, on_delete=models.PROTECT, related_name="entries")
    source_type = models.CharField(max_length=32)
    source_id = models.PositiveIntegerField()
    idempotency_key = models.CharField(max_length=255)
    description = models.CharField(max_length=255)
    reason_code = models.CharField(max_length=64, blank=True, default="")
    reverses = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.PROTECT, related_name="reversed_by",
    )
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)

    class Meta:
        ordering = ["id"]
        verbose_name_plural = "Journal entries"
        constraints = [
            models.UniqueConstraint(fields=["idempotency_key"], name="uniq_je_idempotency"),
        ]
        indexes = [models.Index(fields=["source_type", "source_id"])]

    def __str__(self):
        return f"JE#{self.pk} {self.description}"

    def save(self, *args, **kwargs):
        if self.pk:
            raise ImmutableLedgerError(
                "journal entries are immutable — post a reversal instead"
            )
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ImmutableLedgerError("journal entries cannot be deleted")


class JournalLine(TimeStampedModel):
    """One debit or credit within a `JournalEntry`. Exactly one side is non-zero."""

    entry = models.ForeignKey(JournalEntry, on_delete=models.PROTECT, related_name="lines")
    line_no = models.PositiveSmallIntegerField()
    account = models.ForeignKey(Account, on_delete=models.PROTECT, related_name="journal_lines")
    debit = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0.00"))
    credit = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0.00"))
    # Party — mandatory on RECEIVABLE/PAYABLE accounts, forbidden elsewhere.
    party_type = models.CharField(max_length=16, blank=True, default="")
    party_id = models.PositiveIntegerField(null=True, blank=True)
    # Dimension: which doctor this line's revenue/cost is attributed to.
    doctor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.PROTECT, related_name="+",
    )
    # Traceability back to the billing line that caused this posting.
    invoice_item = models.ForeignKey(
        "billing.InvoiceItem", null=True, blank=True,
        on_delete=models.PROTECT, related_name="journal_lines",
    )
    memo = models.CharField(max_length=255, blank=True, default="")

    class Meta:
        ordering = ["entry_id", "line_no"]
        constraints = [
            models.UniqueConstraint(fields=["entry", "line_no"], name="uniq_journal_line_no"),
            models.CheckConstraint(
                condition=models.Q(debit__gte=0) & models.Q(credit__gte=0),
                name="jl_non_negative",
            ),
            models.CheckConstraint(
                condition=(
                    (models.Q(debit=0) & ~models.Q(credit=0))
                    | (~models.Q(debit=0) & models.Q(credit=0))
                ),
                name="jl_exactly_one_side",
            ),
        ]
        indexes = [
            models.Index(fields=["party_type", "party_id"]),
        ]

    def __str__(self):
        side = f"Dr {self.debit}" if self.debit else f"Cr {self.credit}"
        return f"{self.account.code} {side}"

    def save(self, *args, **kwargs):
        if self.pk:
            raise ImmutableLedgerError(
                "journal lines are immutable — post a reversal instead"
            )
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ImmutableLedgerError("journal lines cannot be deleted")
