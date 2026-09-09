"""Financial roadmap Task 4 — accounting core: accounts, account map, periods.

The ledger itself (JournalEntry/JournalLine, PostingService) is Task 5 and
lives in test_accounting_ledger.py; this file only exercises what Task 4
introduced and must not import anything from apps.billing (Task 5's own DoD
requires the accounting app to be testable without billing — kept true here
too, one task early).
"""
from datetime import date

import pytest
from django.core.management import call_command
from django.db import IntegrityError, transaction as db_transaction

from apps.accounting.exceptions import (
    GroupAccountNotPostableError,
    ImmutableAccountCodeError,
    InactiveAccountError,
    OverlappingPeriodError,
    UnmappedPurposeError,
)
from apps.accounting.models import Account, AccountMap, FiscalYear, Period
from apps.core.enums import AccountType, ReportSection, RootType

pytestmark = pytest.mark.django_db


@pytest.fixture
def revenue_group():
    return Account.objects.create(code="9000", name="Revenue Group", root_type=RootType.INCOME, is_group=True)


@pytest.fixture
def revenue_leaf(revenue_group):
    return Account.objects.create(
        code="9001", name="Test Revenue", root_type=RootType.INCOME,
        account_type=AccountType.INCOME, parent=revenue_group,
    )


class TestAccountTree:
    def test_children_relate_to_parent(self, revenue_group, revenue_leaf):
        assert list(revenue_group.children.all()) == [revenue_leaf]

    def test_duplicate_code_raises_integrity_error(self, revenue_leaf):
        with pytest.raises(IntegrityError):
            with db_transaction.atomic():
                Account.objects.create(
                    code="9001", name="Duplicate", root_type=RootType.INCOME,
                )

    def test_report_section_balance_sheet_roots(self):
        for root_type in (RootType.ASSET, RootType.LIABILITY, RootType.EQUITY):
            account = Account.objects.create(
                code=f"bs-{root_type}", name="x", root_type=root_type,
            )
            assert account.report_section == ReportSection.BALANCE_SHEET

    def test_report_section_profit_and_loss_roots(self):
        for root_type in (RootType.INCOME, RootType.EXPENSE):
            account = Account.objects.create(
                code=f"pl-{root_type}", name="x", root_type=root_type,
            )
            assert account.report_section == ReportSection.PROFIT_AND_LOSS


class TestPostability:
    def test_group_account_refuses_posting(self, revenue_group):
        with pytest.raises(GroupAccountNotPostableError):
            revenue_group.assert_postable()

    def test_inactive_account_refuses_posting(self, revenue_leaf):
        revenue_leaf.is_active = False
        revenue_leaf.save()
        with pytest.raises(InactiveAccountError):
            revenue_leaf.assert_postable()

    def test_active_leaf_is_postable(self, revenue_leaf):
        revenue_leaf.assert_postable()  # does not raise


class TestAccountCodeImmutability:
    def test_unused_account_code_can_change(self, revenue_leaf):
        revenue_leaf.code = "9002"
        revenue_leaf.save()  # does not raise
        revenue_leaf.refresh_from_db()
        assert revenue_leaf.code == "9002"

    def test_mapped_account_code_is_immutable(self, revenue_leaf):
        AccountMap.objects.create(purpose="TEST_PURPOSE", account=revenue_leaf)
        revenue_leaf.code = "9099"
        with pytest.raises(ImmutableAccountCodeError):
            revenue_leaf.save()

    def test_renaming_without_changing_code_is_fine(self, revenue_leaf):
        AccountMap.objects.create(purpose="TEST_PURPOSE", account=revenue_leaf)
        revenue_leaf.name = "Renamed"
        revenue_leaf.save()  # does not raise — only `code` is protected


class TestAccountMap:
    def test_resolve_returns_mapped_account(self, revenue_leaf):
        AccountMap.objects.create(purpose="TEST_ONLY_PURPOSE", account=revenue_leaf)
        assert AccountMap.resolve("TEST_ONLY_PURPOSE") == revenue_leaf

    def test_resolve_raises_when_unmapped(self):
        with pytest.raises(UnmappedPurposeError):
            AccountMap.resolve("NO_SUCH_PURPOSE")

    def test_resolve_is_qualifier_specific(self, revenue_leaf, revenue_group):
        AccountMap.objects.create(purpose="REVENUE", qualifier="LAB_TEST", account=revenue_leaf)
        assert AccountMap.resolve("REVENUE", "LAB_TEST") == revenue_leaf
        with pytest.raises(UnmappedPurposeError):
            AccountMap.resolve("REVENUE", "PROCEDURE")

    def test_duplicate_purpose_qualifier_raises_integrity_error(self, revenue_leaf, revenue_group):
        AccountMap.objects.create(purpose="TEST_ONLY_PURPOSE", qualifier="", account=revenue_leaf)
        with pytest.raises(IntegrityError):
            with db_transaction.atomic():
                AccountMap.objects.create(
                    purpose="TEST_ONLY_PURPOSE", qualifier="", account=revenue_group,
                )


class TestFiscalYearAndPeriod:
    def test_fiscal_year_end_before_start_raises_integrity_error(self):
        with pytest.raises(IntegrityError):
            with db_transaction.atomic():
                FiscalYear.objects.create(
                    name="FY-bad", start_date=date(2026, 12, 31), end_date=date(2026, 1, 1),
                )

    def test_periods_cannot_overlap(self):
        fy = FiscalYear.objects.create(
            name="FY2026", start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
        )
        Period.objects.create(
            fiscal_year=fy, name="Jan", start_date=date(2026, 1, 1), end_date=date(2026, 1, 31),
        )
        with pytest.raises(OverlappingPeriodError):
            Period.objects.create(
                fiscal_year=fy, name="Overlap",
                start_date=date(2026, 1, 15), end_date=date(2026, 2, 15),
            )

    def test_adjacent_non_overlapping_periods_are_fine(self):
        fy = FiscalYear.objects.create(
            name="FY2027", start_date=date(2027, 1, 1), end_date=date(2027, 12, 31),
        )
        Period.objects.create(
            fiscal_year=fy, name="Jan", start_date=date(2027, 1, 1), end_date=date(2027, 1, 31),
        )
        Period.objects.create(
            fiscal_year=fy, name="Feb", start_date=date(2027, 2, 1), end_date=date(2027, 2, 28),
        )  # does not raise

    def test_for_date_finds_the_containing_period(self):
        fy = FiscalYear.objects.create(
            name="FY2028", start_date=date(2028, 1, 1), end_date=date(2028, 12, 31),
        )
        jan = Period.objects.create(
            fiscal_year=fy, name="Jan", start_date=date(2028, 1, 1), end_date=date(2028, 1, 31),
        )
        assert Period.for_date(date(2028, 1, 15)) == jan
        assert Period.for_date(date(2028, 2, 1)) is None


class TestSeedChartOfAccounts:
    def test_seed_creates_the_tree_and_map(self):
        call_command("seed_chart_of_accounts")
        assert Account.objects.filter(code="1000").exists()
        assert Account.objects.filter(code="1210", account_type=AccountType.RECEIVABLE).exists()
        assert AccountMap.resolve("AR_PATIENT").code == "1210"
        assert AccountMap.resolve("REVENUE_BY_SERVICE_CATEGORY", "CONSULTATION").code == "4111"
        assert AccountMap.resolve("CASH_DEFAULT").code == "1111"

    def test_seed_is_idempotent(self):
        call_command("seed_chart_of_accounts")
        count_after_first = Account.objects.count()
        call_command("seed_chart_of_accounts")
        assert Account.objects.count() == count_after_first

    def test_group_accounts_are_never_postable(self):
        call_command("seed_chart_of_accounts")
        groups = Account.objects.filter(is_group=True)
        assert groups.exists()
        for account in groups:
            with pytest.raises(GroupAccountNotPostableError):
                account.assert_postable()

    def test_every_leaf_root_type_matches_its_top_level_root(self):
        """Every account under 1000/2000/3000/4000/5000 shares that root's root_type."""
        call_command("seed_chart_of_accounts")
        roots = {
            "1": RootType.ASSET, "2": RootType.LIABILITY, "3": RootType.EQUITY,
            "4": RootType.INCOME, "5": RootType.EXPENSE,
        }
        for account in Account.objects.all():
            assert account.root_type == roots[account.code[0]]
