"""Pre-merge blocker resolution — accounting bootstrap / production
preflight (Chart of Accounts, AccountMap, FiscalYear, Period).

`apps.accounting` has never been deployed to production; after `migrate`
the new tables exist but are empty. These commands close that gap:
`seed_chart_of_accounts` (already existed, Task 4) is idempotent by design
(`get_or_create`, never edits an existing row); `bootstrap_period` and
`finance_preflight` are new here.

The chart of accounts + an open Period covering "today" are already seeded
once for the whole test session (see tests/conftest.py's django_db_setup
override) — tests that need a *broken* state delete/modify specific rows
first, inside their own (rolled-back) test transaction.
"""
from datetime import date, timedelta
from decimal import Decimal
from io import StringIO

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from django.utils import timezone

from apps.accounting.models import Account, AccountMap, FiscalYear, Period
from apps.billing.models import Invoice, InvoiceItem, ServiceItem
from apps.core.enums import FiscalYearStatus, InvoiceStatus, PeriodStatus

pytestmark = pytest.mark.django_db


# --- finance_preflight ---------------------------------------------------------

class TestFinancePreflight:
    def test_passes_on_the_healthy_seeded_baseline(self):
        out = StringIO()
        call_command("finance_preflight", stdout=out)
        assert "Finance preflight OK" in out.getvalue()

    def test_fails_when_a_required_purpose_is_unmapped(self):
        AccountMap.objects.filter(purpose="AR_PATIENT", qualifier="").delete()
        with pytest.raises(CommandError) as exc:
            call_command("finance_preflight")
        assert "AR_PATIENT" in str(exc.value)

    def test_fails_when_the_mapped_account_is_a_group_account(self):
        """AccountMap.resolve() itself would succeed (the row exists), but
        Account.assert_postable() must still catch a mapping that points at
        a non-leaf account."""
        mapping = AccountMap.objects.get(purpose="AR_PATIENT", qualifier="")
        mapping.account.is_group = True
        mapping.account.save(update_fields=["is_group"])
        with pytest.raises(CommandError) as exc:
            call_command("finance_preflight")
        assert "AR_PATIENT" in str(exc.value)

    def test_fails_when_no_period_covers_today(self):
        Period.objects.filter(
            start_date__lte=timezone.localdate(), end_date__gte=timezone.localdate(),
        ).delete()
        with pytest.raises(CommandError) as exc:
            call_command("finance_preflight")
        assert "No Period covers" in str(exc.value)

    def test_fails_when_the_covering_period_is_not_open(self):
        period = Period.for_date(timezone.localdate())
        period.status = PeriodStatus.CLOSED
        period.save(update_fields=["status"])
        with pytest.raises(CommandError) as exc:
            call_command("finance_preflight")
        assert "not OPEN" in str(exc.value)

    def test_never_modifies_anything(self):
        """Read-only, explicitly: run it twice and confirm the row counts
        for every table it touches are unchanged."""
        before = (
            Account.objects.count(), AccountMap.objects.count(),
            FiscalYear.objects.count(), Period.objects.count(),
        )
        call_command("finance_preflight", stdout=StringIO())
        call_command("finance_preflight", stdout=StringIO())
        after = (
            Account.objects.count(), AccountMap.objects.count(),
            FiscalYear.objects.count(), Period.objects.count(),
        )
        assert before == after


# --- bootstrap_period ------------------------------------------------------------

class TestBootstrapPeriod:
    def test_noop_when_a_period_already_covers_the_target_date(self):
        before_periods = Period.objects.count()
        before_years = FiscalYear.objects.count()
        out = StringIO()
        call_command("bootstrap_period", stdout=out)
        assert "nothing to do" in out.getvalue()
        assert Period.objects.count() == before_periods
        assert FiscalYear.objects.count() == before_years

    def test_refuses_to_guess_a_new_fiscal_year(self):
        far_future = (timezone.localdate() + timedelta(days=3650)).isoformat()
        with pytest.raises(CommandError) as exc:
            call_command("bootstrap_period", f"--for-date={far_future}")
        assert "business decision" in str(exc.value)
        # Nothing was created by the failed attempt.
        assert not FiscalYear.objects.filter(
            start_date__lte=far_future, end_date__gte=far_future,
        ).exists()

    def test_creates_fiscal_year_and_period_when_explicit_dates_are_given(self):
        target = timezone.localdate() + timedelta(days=3650)
        year_start = date(target.year, 1, 1)
        year_end = date(target.year, 12, 31)
        call_command(
            "bootstrap_period",
            f"--for-date={target.isoformat()}",
            f"--fiscal-year-start={year_start.isoformat()}",
            f"--fiscal-year-end={year_end.isoformat()}",
        )
        fiscal_year = FiscalYear.objects.get(name=str(target.year))
        assert fiscal_year.start_date == year_start
        assert fiscal_year.end_date == year_end
        assert fiscal_year.status == FiscalYearStatus.OPEN

        period = Period.for_date(target)
        assert period is not None
        assert period.fiscal_year_id == fiscal_year.id
        assert period.status == PeriodStatus.OPEN
        assert period.start_date == date(target.year, target.month, 1)

    def test_is_idempotent_when_re_run_with_the_same_arguments(self):
        target = timezone.localdate() + timedelta(days=3660)
        year_start, year_end = date(target.year, 1, 1), date(target.year, 12, 31)
        args = [
            f"--for-date={target.isoformat()}",
            f"--fiscal-year-start={year_start.isoformat()}",
            f"--fiscal-year-end={year_end.isoformat()}",
        ]
        call_command("bootstrap_period", *args)
        fy_count, period_count = FiscalYear.objects.count(), Period.objects.count()
        call_command("bootstrap_period", *args)
        assert FiscalYear.objects.count() == fy_count
        assert Period.objects.count() == period_count

    def test_rolls_forward_into_a_new_month_with_no_arguments(self):
        """Once a FiscalYear exists, a later month only needs --for-date (or
        even nothing, for "today") — no business decision left to make."""
        target = timezone.localdate() + timedelta(days=3670)
        year_start, year_end = date(target.year, 1, 1), date(target.year, 12, 31)
        call_command(
            "bootstrap_period",
            f"--for-date={target.isoformat()}",
            f"--fiscal-year-start={year_start.isoformat()}",
            f"--fiscal-year-end={year_end.isoformat()}",
        )
        next_month_date = (target.replace(day=1) + timedelta(days=32)).replace(day=1)
        assert Period.for_date(next_month_date) is None  # not created yet

        call_command("bootstrap_period", f"--for-date={next_month_date.isoformat()}")
        period = Period.for_date(next_month_date)
        assert period is not None
        assert period.fiscal_year.start_date == year_start

    def test_refuses_to_alter_an_existing_fiscal_year_with_conflicting_dates(self):
        target = timezone.localdate() + timedelta(days=3680)
        FiscalYear.objects.create(
            name=str(target.year), start_date=date(target.year, 1, 1),
            end_date=date(target.year, 6, 30),  # deliberately NOT covering `target`
        )
        with pytest.raises(CommandError) as exc:
            call_command(
                "bootstrap_period",
                f"--for-date={target.isoformat()}",
                f"--fiscal-year-start={date(target.year, 1, 1).isoformat()}",
                f"--fiscal-year-end={date(target.year, 12, 31).isoformat()}",
            )
        assert "already exists with different dates" in str(exc.value)


# --- seed_chart_of_accounts (already existed — confirming it stays safe) --------

class TestSeedChartOfAccountsIdempotency:
    def test_running_it_twice_creates_nothing_new_the_second_time(self):
        call_command("seed_chart_of_accounts", stdout=StringIO())
        accounts_before, maps_before = Account.objects.count(), AccountMap.objects.count()

        out = StringIO()
        call_command("seed_chart_of_accounts", stdout=out)
        assert Account.objects.count() == accounts_before
        assert AccountMap.objects.count() == maps_before
        assert "0 created" in out.getvalue()

    def test_never_alters_an_existing_accounts_code(self):
        account = AccountMap.objects.get(purpose="AR_PATIENT", qualifier="").account
        original_name = account.name
        call_command("seed_chart_of_accounts", stdout=StringIO())
        account.refresh_from_db()
        assert account.name == original_name


class TestSeedPreservesAccountantCustomization:
    """Pre-merge blocker resolution — explicit proof that re-running
    seed_chart_of_accounts (e.g. as part of every deploy, see deploy.sh)
    never overwrites an accountant's own configuration. `get_or_create`'s
    `defaults=` is only ever applied when creating a *new* row — this is
    already true by construction, verified here rather than assumed."""

    def test_does_not_overwrite_a_purpose_remapped_to_a_different_custom_account(self):
        original_account = AccountMap.objects.get(purpose="AR_PATIENT", qualifier="").account
        custom_account = AccountMap.objects.get(purpose="BANK_DEFAULT", qualifier="").account
        assert custom_account.pk != original_account.pk

        mapping = AccountMap.objects.get(purpose="AR_PATIENT", qualifier="")
        mapping.account = custom_account
        mapping.save(update_fields=["account"])

        call_command("seed_chart_of_accounts", stdout=StringIO())

        mapping.refresh_from_db()
        assert mapping.account_id == custom_account.pk
        assert AccountMap.resolve("AR_PATIENT").pk == custom_account.pk

    def test_does_not_rewrite_a_renamed_accounts_properties(self):
        account = AccountMap.objects.get(purpose="AR_PATIENT", qualifier="").account
        account.name = "Custom Renamed Receivable Account"
        account.name_ar = "حساب مخصص"
        account.save(update_fields=["name", "name_ar"])

        call_command("seed_chart_of_accounts", stdout=StringIO())

        account.refresh_from_db()
        assert account.name == "Custom Renamed Receivable Account"
        assert account.name_ar == "حساب مخصص"


# --- check_legacy_billing_values -------------------------------------------------

class TestCheckLegacyBillingValues:
    def test_reports_zero_on_clean_data(self):
        out = StringIO()
        call_command("check_legacy_billing_values", stdout=out)
        output = out.getvalue()
        assert "PRESCRIPTION'): 0" in output
        assert "MEDICATION'): 0" in output
        assert "No legacy" in output

    def test_detects_an_existing_legacy_invoice_item(self, patient, doctor_profile):
        invoice = Invoice.objects.create(
            patient=patient, doctor=doctor_profile.user, status=InvoiceStatus.ISSUED,
        )
        InvoiceItem.objects.create(
            invoice=invoice, description="legacy prescription line",
            unit_price=Decimal("10.00"), source_type="PRESCRIPTION",
        )
        out = StringIO()
        call_command("check_legacy_billing_values", stdout=out)
        output = out.getvalue()
        assert "PRESCRIPTION'): 1" in output
        assert "Legacy rows found" in output

    def test_detects_an_existing_legacy_service_item(self):
        ServiceItem.objects.create(
            name="Legacy medication line", item_type="MEDICATION",
            default_price=Decimal("5.00"),
        )
        out = StringIO()
        call_command("check_legacy_billing_values", stdout=out)
        output = out.getvalue()
        assert "MEDICATION'): 1" in output
        assert "Legacy rows found" in output

    def test_is_read_only(self, patient, doctor_profile):
        invoice = Invoice.objects.create(
            patient=patient, doctor=doctor_profile.user, status=InvoiceStatus.ISSUED,
        )
        InvoiceItem.objects.create(
            invoice=invoice, description="legacy", unit_price=Decimal("10.00"),
            source_type="PRESCRIPTION",
        )
        before = (InvoiceItem.objects.count(), ServiceItem.objects.count())
        call_command("check_legacy_billing_values", stdout=StringIO())
        call_command("check_legacy_billing_values", stdout=StringIO())
        after = (InvoiceItem.objects.count(), ServiceItem.objects.count())
        assert before == after
