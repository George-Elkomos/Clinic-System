"""Accounting core (financial roadmap Task 4) — chart of accounts and periods.

`Account` is a tree via a self-FK; only leaves (`is_group=False`) are ever
postable. `AccountMap` is the one place code may ask "which account handles
X" — callers resolve by *purpose*, never by hard-coded account code, and
`resolve()` raises rather than silently returning nothing. `FiscalYear` and
`Period` give every future posting a period to resolve against; periods are
enforced non-overlapping across the whole ledger (not just within one fiscal
year), since a posting date must resolve to exactly one period.

The ledger itself (`JournalEntry`/`JournalLine`) and the posting engine are
Task 5 — this module is deliberately postable-free.
"""
from django.db import models

from apps.core.enums import AccountType, FiscalYearStatus, PeriodStatus, ReportSection, RootType
from apps.core.models import TimeStampedModel

from .exceptions import (
    GroupAccountNotPostableError,
    ImmutableAccountCodeError,
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
        """True once anything depends on this account's code meaning what it says.

        Task 4: referenced by an `AccountMap` entry. Task 5 extends this to
        also check journal lines once the ledger exists.
        """
        return AccountMap.objects.filter(account=self).exists()

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
