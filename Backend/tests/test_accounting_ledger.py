"""Financial roadmap Task 5 — the ledger and posting engine.

Deliberately does not import anything from apps.billing (Task 5's own DoD:
"every apps/accounting test passes without importing anything from billing").
`party_id` below is just an arbitrary integer standing in for "some patient" —
the ledger itself never cares what kind of row a party_id points to.
"""
import random
import threading
from datetime import date
from decimal import Decimal

import pytest
from django.db import IntegrityError
from django.db import transaction as db_transaction

from apps.accounting import services
from apps.accounting.exceptions import (
    ImbalancedEntryError,
    NoPeriodForDateError,
    PartyForbiddenError,
    PartyRequiredError,
    PeriodClosedError,
    ReasonCodeRequiredError,
    StructureError,
)
from apps.accounting.models import Account, FiscalYear, JournalEntry, JournalLine, Period
from apps.core.enums import AccountType, FiscalYearStatus, PeriodStatus, RoleChoices, RootType

pytestmark = pytest.mark.django_db


@pytest.fixture
def user(make_user):
    return make_user("ledger-user@test.dev", RoleChoices.MANAGER)


@pytest.fixture
def open_period():
    fy = FiscalYear.objects.create(
        name="FY-Ledger-Open", start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
    )
    return Period.objects.create(
        fiscal_year=fy, name="Jan-2026", start_date=date(2026, 1, 1), end_date=date(2026, 1, 31),
    )


@pytest.fixture
def closed_period():
    fy = FiscalYear.objects.create(
        name="FY-Ledger-Closed", start_date=date(2025, 1, 1), end_date=date(2025, 12, 31),
        status=FiscalYearStatus.CLOSED,
    )
    return Period.objects.create(
        fiscal_year=fy, name="Dec-2025", start_date=date(2025, 12, 1), end_date=date(2025, 12, 31),
        status=PeriodStatus.CLOSED,
    )


@pytest.fixture
def cash(open_period):
    return Account.objects.create(
        code="t-cash", name="Test Cash", root_type=RootType.ASSET, account_type=AccountType.CASH,
    )


@pytest.fixture
def revenue(open_period):
    return Account.objects.create(
        code="t-rev", name="Test Revenue", root_type=RootType.INCOME,
        account_type=AccountType.INCOME,
    )


@pytest.fixture
def ar(open_period):
    return Account.objects.create(
        code="t-ar", name="Test AR", root_type=RootType.ASSET,
        account_type=AccountType.RECEIVABLE,
    )


@pytest.fixture
def group_account(open_period):
    return Account.objects.create(
        code="t-group", name="Test Group", root_type=RootType.ASSET, is_group=True,
    )


def _post_cash_sale(user, cash, revenue, amount, key, posting_date=date(2026, 1, 15)):
    return services.post(
        posting_date=posting_date,
        source_type="Test",
        source_id=1,
        description="Cash sale",
        lines=[
            {"account": cash, "debit": amount},
            {"account": revenue, "credit": amount},
        ],
        idempotency_key=key,
        user=user,
    )


class TestBalanceInvariant:
    def test_balanced_entry_posts(self, user, cash, revenue):
        entry = _post_cash_sale(user, cash, revenue, Decimal("100.00"), "je:balanced")
        assert entry.lines.count() == 2

    def test_random_unbalanced_entries_are_always_refused(self, user, cash, revenue):
        rng = random.Random(42)
        for i in range(25):
            debit = Decimal(rng.randint(1, 100000)) / 100
            credit = Decimal(rng.randint(1, 100000)) / 100
            if debit == credit:
                credit += Decimal("0.01")
            with pytest.raises(ImbalancedEntryError):
                services.post(
                    posting_date=date(2026, 1, 15), source_type="Test", source_id=i,
                    description="unbalanced", lines=[
                        {"account": cash, "debit": debit},
                        {"account": revenue, "credit": credit},
                    ],
                    idempotency_key=f"je:unbalanced:{i}", user=user,
                )

    def test_random_balanced_entries_always_post(self, user, cash, revenue):
        rng = random.Random(7)
        for i in range(25):
            amount = Decimal(rng.randint(1, 100000)) / 100
            entry = services.post(
                posting_date=date(2026, 1, 15), source_type="Test", source_id=i,
                description="balanced", lines=[
                    {"account": cash, "debit": amount},
                    {"account": revenue, "credit": amount},
                ],
                idempotency_key=f"je:balanced-random:{i}", user=user,
            )
            assert entry.pk is not None

    def test_no_lines_no_op_still_requires_two_lines(self, user, cash):
        with pytest.raises(StructureError):
            services.post(
                posting_date=date(2026, 1, 15), source_type="Test", source_id=1,
                description="one line", lines=[{"account": cash, "debit": Decimal("10.00")}],
                idempotency_key="je:one-line", user=user,
            )

    def test_negative_amount_refused(self, user, cash, revenue):
        with pytest.raises(StructureError):
            services.post(
                posting_date=date(2026, 1, 15), source_type="Test", source_id=1,
                description="negative", lines=[
                    {"account": cash, "debit": Decimal("-10.00")},
                    {"account": revenue, "credit": Decimal("-10.00")},
                ],
                idempotency_key="je:negative", user=user,
            )

    def test_line_with_both_sides_refused(self, user, cash, revenue):
        with pytest.raises(StructureError):
            services.post(
                posting_date=date(2026, 1, 15), source_type="Test", source_id=1,
                description="both sides", lines=[
                    {"account": cash, "debit": Decimal("10.00"), "credit": Decimal("10.00")},
                    {"account": revenue, "credit": Decimal("10.00")},
                ],
                idempotency_key="je:both-sides", user=user,
            )


class TestIdempotency:
    def test_same_key_twice_returns_the_same_entry(self, user, cash, revenue):
        first = _post_cash_sale(user, cash, revenue, Decimal("50.00"), "je:idem-1")
        second = _post_cash_sale(user, cash, revenue, Decimal("50.00"), "je:idem-1")
        assert first.pk == second.pk
        assert JournalEntry.objects.filter(idempotency_key="je:idem-1").count() == 1

    @pytest.mark.django_db(transaction=True)
    def test_concurrent_posts_with_same_key_produce_one_entry(self, user, cash, revenue):
        """Two real threads racing the same idempotency_key must converge on one entry."""
        from django.db import connection

        results = []
        barrier = threading.Barrier(2)

        def _worker():
            barrier.wait()
            try:
                entry = _post_cash_sale(user, cash, revenue, Decimal("75.00"), "je:race")
                results.append(entry.pk)
            except Exception as exc:  # pragma: no cover - surfaced via assertion below
                results.append(exc)
            finally:
                connection.close()

        t1 = threading.Thread(target=_worker)
        t2 = threading.Thread(target=_worker)
        t1.start()
        t2.start()
        t1.join()
        t2.join()

        assert len(results) == 2
        assert all(isinstance(r, int) for r in results), results
        assert results[0] == results[1]
        assert JournalEntry.objects.filter(idempotency_key="je:race").count() == 1


class TestImmutability:
    def test_updating_an_existing_entry_raises(self, user, cash, revenue):
        from apps.accounting.exceptions import ImmutableLedgerError

        entry = _post_cash_sale(user, cash, revenue, Decimal("10.00"), "je:immutable-1")
        entry.description = "changed"
        with pytest.raises(ImmutableLedgerError):
            entry.save()

    def test_deleting_an_entry_raises(self, user, cash, revenue):
        from apps.accounting.exceptions import ImmutableLedgerError

        entry = _post_cash_sale(user, cash, revenue, Decimal("10.00"), "je:immutable-2")
        with pytest.raises(ImmutableLedgerError):
            entry.delete()

    def test_bulk_update_is_rejected_by_the_db_trigger(self, user, cash, revenue):
        entry = _post_cash_sale(user, cash, revenue, Decimal("10.00"), "je:immutable-3")
        with pytest.raises(Exception):  # psycopg raises a DB-level ProgrammingError
            with db_transaction.atomic():
                JournalEntry.objects.filter(pk=entry.pk).update(description="hacked")
        entry.refresh_from_db()
        assert entry.description == "Cash sale"

    def test_bulk_delete_is_rejected_by_the_db_trigger(self, user, cash, revenue):
        entry = _post_cash_sale(user, cash, revenue, Decimal("10.00"), "je:immutable-4")
        with pytest.raises(Exception):
            with db_transaction.atomic():
                JournalEntry.objects.filter(pk=entry.pk).delete()
        assert JournalEntry.objects.filter(pk=entry.pk).exists()

    def test_updating_a_line_raises(self, user, cash, revenue):
        from apps.accounting.exceptions import ImmutableLedgerError

        entry = _post_cash_sale(user, cash, revenue, Decimal("10.00"), "je:immutable-5")
        line = entry.lines.first()
        line.memo = "changed"
        with pytest.raises(ImmutableLedgerError):
            line.save()

    def test_deleting_a_line_raises(self, user, cash, revenue):
        from apps.accounting.exceptions import ImmutableLedgerError

        entry = _post_cash_sale(user, cash, revenue, Decimal("10.00"), "je:immutable-6")
        line = entry.lines.first()
        with pytest.raises(ImmutableLedgerError):
            line.delete()


class TestLineConstraints:
    def test_both_sides_nonzero_raises_integrity_error_at_db_level(self, user, cash):
        """Bypassing the service layer entirely — the CHECK constraint itself."""
        entry = JournalEntry(
            posting_date=date(2026, 1, 15), period=Period.for_date(date(2026, 1, 15)),
            source_type="Test", source_id=1, idempotency_key="je:raw-1",
            description="raw", created_by=user,
        )
        entry.save()
        with pytest.raises(IntegrityError):
            with db_transaction.atomic():
                JournalLine.objects.create(
                    entry=entry, line_no=1, account=cash,
                    debit=Decimal("5.00"), credit=Decimal("5.00"),
                )

    def test_group_account_cannot_be_posted_to(self, user, group_account, revenue):
        from apps.accounting.exceptions import GroupAccountNotPostableError

        with pytest.raises(GroupAccountNotPostableError):
            services.post(
                posting_date=date(2026, 1, 15), source_type="Test", source_id=1,
                description="group post", lines=[
                    {"account": group_account, "debit": Decimal("10.00")},
                    {"account": revenue, "credit": Decimal("10.00")},
                ],
                idempotency_key="je:group", user=user,
            )


class TestParty:
    def test_receivable_line_without_party_is_refused(self, user, ar, revenue):
        with pytest.raises(PartyRequiredError):
            services.post(
                posting_date=date(2026, 1, 15), source_type="Test", source_id=1,
                description="no party", lines=[
                    {"account": ar, "debit": Decimal("10.00")},
                    {"account": revenue, "credit": Decimal("10.00")},
                ],
                idempotency_key="je:no-party", user=user,
            )

    def test_receivable_line_with_party_posts(self, user, ar, revenue):
        entry = services.post(
            posting_date=date(2026, 1, 15), source_type="Test", source_id=1,
            description="with party", lines=[
                {"account": ar, "debit": Decimal("10.00"), "party_type": "Patient", "party_id": 1},
                {"account": revenue, "credit": Decimal("10.00")},
            ],
            idempotency_key="je:with-party", user=user,
        )
        assert entry.lines.get(account=ar).party_id == 1

    def test_non_party_line_with_party_is_refused(self, user, cash, revenue):
        with pytest.raises(PartyForbiddenError):
            services.post(
                posting_date=date(2026, 1, 15), source_type="Test", source_id=1,
                description="unexpected party", lines=[
                    {
                        "account": cash, "debit": Decimal("10.00"),
                        "party_type": "Patient", "party_id": 1,
                    },
                    {"account": revenue, "credit": Decimal("10.00")},
                ],
                idempotency_key="je:unexpected-party", user=user,
            )


class TestPeriod:
    def test_posting_into_closed_period_is_refused(self, user, cash, revenue, closed_period):
        with pytest.raises(PeriodClosedError):
            services.post(
                posting_date=date(2025, 12, 15), source_type="Test", source_id=1,
                description="closed period", lines=[
                    {"account": cash, "debit": Decimal("10.00")},
                    {"account": revenue, "credit": Decimal("10.00")},
                ],
                idempotency_key="je:closed-period", user=user,
            )

    def test_posting_with_no_period_at_all_is_refused(self, user, cash, revenue):
        with pytest.raises(NoPeriodForDateError):
            services.post(
                posting_date=date(2099, 1, 1), source_type="Test", source_id=1,
                description="no period", lines=[
                    {"account": cash, "debit": Decimal("10.00")},
                    {"account": revenue, "credit": Decimal("10.00")},
                ],
                idempotency_key="je:no-period", user=user,
            )


class TestReversal:
    def test_reversal_mirrors_the_original_exactly(self, user, cash, revenue):
        original = _post_cash_sale(user, cash, revenue, Decimal("40.00"), "je:rev-orig")
        reversal = services.reverse(
            original, reason_code="test_reversal", posting_date=date(2026, 1, 20), user=user,
        )

        assert reversal.reverses_id == original.pk
        assert reversal.reason_code == "test_reversal"
        for orig_line, rev_line in zip(
            original.lines.order_by("line_no"), reversal.lines.order_by("line_no"),
        ):
            assert orig_line.account_id == rev_line.account_id
            assert orig_line.debit == rev_line.credit
            assert orig_line.credit == rev_line.debit

    def test_reversal_leaves_the_original_untouched(self, user, cash, revenue):
        original = _post_cash_sale(user, cash, revenue, Decimal("40.00"), "je:rev-untouched")
        original_lines = list(original.lines.values("account_id", "debit", "credit"))
        services.reverse(original, reason_code="test", posting_date=date(2026, 1, 20), user=user)
        original.refresh_from_db()
        assert list(original.lines.values("account_id", "debit", "credit")) == original_lines

    def test_reversal_requires_a_reason_code(self, user, cash, revenue):
        original = _post_cash_sale(user, cash, revenue, Decimal("40.00"), "je:rev-noreason")
        with pytest.raises(ReasonCodeRequiredError):
            services.reverse(original, reason_code="", user=user)

    def test_reversal_is_idempotent(self, user, cash, revenue):
        original = _post_cash_sale(user, cash, revenue, Decimal("40.00"), "je:rev-idem")
        first = services.reverse(original, reason_code="test", posting_date=date(2026, 1, 20), user=user)
        second = services.reverse(original, reason_code="test", posting_date=date(2026, 1, 20), user=user)
        assert first.pk == second.pk

    def test_reversing_a_reversal_restores_the_position(self, user, cash, revenue):
        original = _post_cash_sale(user, cash, revenue, Decimal("40.00"), "je:rev-double")
        reversal = services.reverse(
            original, reason_code="oops", posting_date=date(2026, 1, 20), user=user,
        )
        undo = services.reverse(
            reversal, reason_code="undo the oops", posting_date=date(2026, 1, 21), user=user,
        )

        for orig_line, undo_line in zip(
            original.lines.order_by("line_no"), undo.lines.order_by("line_no"),
        ):
            assert orig_line.account_id == undo_line.account_id
            assert orig_line.debit == undo_line.debit
            assert orig_line.credit == undo_line.credit

        # Net ledger effect of all three entries == effect of the original alone.
        assert services.account_balance(cash) == Decimal("40.00")
        assert services.account_balance(revenue) == Decimal("-40.00")


class TestPartialFailure:
    def test_a_failure_partway_through_the_lines_writes_nothing(self, user, cash, revenue, monkeypatch):
        # 6 structurally-valid, balanced lines (3 debit/3 credit pairs); force the
        # 5th JournalLine.objects.create() call to blow up mid-transaction.
        lines = [
            {"account": cash, "debit": Decimal("10.00")},
            {"account": revenue, "credit": Decimal("10.00")},
            {"account": cash, "debit": Decimal("20.00")},
            {"account": revenue, "credit": Decimal("20.00")},
            {"account": cash, "debit": Decimal("30.00")},
            {"account": revenue, "credit": Decimal("30.00")},
        ]
        original_create = JournalLine.objects.create
        call_count = {"n": 0}

        def _flaky_create(*args, **kwargs):
            call_count["n"] += 1
            if call_count["n"] == 5:
                raise RuntimeError("simulated failure on line 5")
            return original_create(*args, **kwargs)

        monkeypatch.setattr(JournalLine.objects, "create", _flaky_create)

        with pytest.raises(RuntimeError):
            services.post(
                posting_date=date(2026, 1, 15), source_type="Test", source_id=1,
                description="partial failure", lines=lines,
                idempotency_key="je:partial-failure", user=user,
            )

        assert JournalEntry.objects.filter(idempotency_key="je:partial-failure").count() == 0
        assert not JournalLine.objects.filter(entry__idempotency_key="je:partial-failure").exists()


class TestBalanceService:
    def test_account_balance_derives_from_lines(self, user, cash, revenue):
        _post_cash_sale(user, cash, revenue, Decimal("100.00"), "je:bal-1")
        _post_cash_sale(user, cash, revenue, Decimal("50.00"), "je:bal-2")
        assert services.account_balance(cash) == Decimal("150.00")
        assert services.account_balance(revenue) == Decimal("-150.00")

    def test_account_balance_respects_as_of(self, user, cash, revenue):
        _post_cash_sale(user, cash, revenue, Decimal("100.00"), "je:asof-1", posting_date=date(2026, 1, 5))
        _post_cash_sale(user, cash, revenue, Decimal("50.00"), "je:asof-2", posting_date=date(2026, 1, 20))
        assert services.account_balance(cash, as_of=date(2026, 1, 10)) == Decimal("100.00")
        assert services.account_balance(cash, as_of=date(2026, 1, 25)) == Decimal("150.00")

    def test_party_balance(self, user, ar, revenue):
        services.post(
            posting_date=date(2026, 1, 15), source_type="Test", source_id=1,
            description="party bal", lines=[
                {"account": ar, "debit": Decimal("30.00"), "party_type": "Patient", "party_id": 42},
                {"account": revenue, "credit": Decimal("30.00")},
            ],
            idempotency_key="je:party-bal", user=user,
        )
        assert services.party_balance("Patient", 42) == Decimal("30.00")
        assert services.party_balance("Patient", 999) == Decimal("0.00")

    def test_trial_balance_is_zero_over_a_randomised_dataset(self, user, cash, revenue, ar):
        rng = random.Random(99)
        for i in range(40):
            amount = Decimal(rng.randint(1, 500000)) / 100
            if rng.random() < 0.5:
                services.post(
                    posting_date=date(2026, 1, 15), source_type="Test", source_id=i,
                    description="random", lines=[
                        {"account": cash, "debit": amount},
                        {"account": revenue, "credit": amount},
                    ],
                    idempotency_key=f"je:trial-{i}", user=user,
                )
            else:
                services.post(
                    posting_date=date(2026, 1, 15), source_type="Test", source_id=i,
                    description="random-ar", lines=[
                        {
                            "account": ar, "debit": amount,
                            "party_type": "Patient", "party_id": i,
                        },
                        {"account": revenue, "credit": amount},
                    ],
                    idempotency_key=f"je:trial-ar-{i}", user=user,
                )

        tb = services.trial_balance()
        assert tb["is_balanced"] is True
        assert tb["total_debit"] == tb["total_credit"]
        assert sum((row["balance"] for row in tb["rows"]), Decimal("0.00")) == Decimal("0.00")
