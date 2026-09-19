"""Financial roadmap Task 17 — cash movements in/out of a till that are not a
patient payment or refund: the opening float (posted once, at `open_shift`)
and mid-shift `FLOAT_IN`/`BANK_DEPOSIT` movements (`services.record_cash_movement`,
exposed via `/api/cash-movements/`).

Task 11's own variance/expected_cash formula must stay intact — these tests
check that explicitly, per the roadmap's own note that Task 11 is unaffected.
"""
import uuid
from decimal import Decimal

import pytest
from django.db import IntegrityError
from django.db import transaction as db_transaction
from django.urls import reverse
from rest_framework.exceptions import ValidationError

from apps.accounting import services as accounting_services
from apps.accounting.models import AccountMap, JournalEntry
from apps.billing import services as billing_services
from apps.billing.exceptions import CashMovementImmutableError
from apps.billing.models import CashMovement
from apps.core.enums import CashMovementType, RoleChoices

pytestmark = pytest.mark.django_db


def _idem():
    return {"Idempotency-Key": str(uuid.uuid4())}


@pytest.fixture
def cashier(make_user):
    return make_user("cm-cashier@test.dev", RoleChoices.SECRETARY)


@pytest.fixture
def other_cashier(make_user):
    return make_user("cm-cashier2@test.dev", RoleChoices.SECRETARY)


@pytest.fixture
def manager(make_user):
    return make_user("cm-manager@test.dev", RoleChoices.MANAGER)


@pytest.fixture
def shift(cashier):
    return billing_services.open_shift(
        cashier=cashier, till_id="CM1", opening_float=Decimal("200.00"),
    )


def _entry_amount(entry):
    lines = list(entry.lines.all())
    debit = sum((line.debit for line in lines), Decimal("0.00"))
    credit = sum((line.credit for line in lines), Decimal("0.00"))
    assert debit == credit
    return debit


class TestOpeningFloatPosting:
    def test_a_nonzero_opening_float_posts_a_balanced_entry(self, cashier):
        shift = billing_services.open_shift(
            cashier=cashier, till_id="CM-open1", opening_float=Decimal("150.00"),
        )
        entry = JournalEntry.objects.get(idempotency_key=f"CashierShift:{shift.id}:open")
        assert _entry_amount(entry) == Decimal("150.00")
        assert entry.lines.get(account=AccountMap.resolve("CASH_DEFAULT")).debit == Decimal("150.00")
        assert entry.lines.get(account=AccountMap.resolve("BANK_DEFAULT")).credit == Decimal("150.00")

    def test_a_zero_opening_float_posts_nothing(self, cashier):
        shift = billing_services.open_shift(cashier=cashier, till_id="CM-open2")
        assert not JournalEntry.objects.filter(
            idempotency_key=f"CashierShift:{shift.id}:open"
        ).exists()

    def test_opening_float_does_not_change_task_11s_expected_cash_formula(self, cashier):
        """Task 11's expected_cash already started from opening_float — this
        proves that figure is unchanged by adding the ledger posting."""
        shift = billing_services.open_shift(
            cashier=cashier, till_id="CM-open3", opening_float=Decimal("300.00"),
        )
        assert billing_services.expected_cash(shift) == Decimal("300.00")


class TestRecordCashMovement:
    def test_a_float_in_increases_expected_cash_and_posts_a_balanced_entry(
        self, shift, cashier,
    ):
        movement = billing_services.record_cash_movement(
            shift=shift, movement_type=CashMovementType.FLOAT_IN,
            amount=Decimal("50.00"), reason="extra float for a busy afternoon",
            created_by=cashier,
        )
        assert billing_services.expected_cash(shift) == Decimal("250.00")
        entry = movement.journal_entry
        assert entry is not None
        assert _entry_amount(entry) == Decimal("50.00")
        assert entry.lines.get(account=AccountMap.resolve("CASH_DEFAULT")).debit == Decimal("50.00")
        assert entry.lines.get(account=AccountMap.resolve("BANK_DEFAULT")).credit == Decimal("50.00")

    def test_a_bank_deposit_decreases_expected_cash_and_posts_the_mirror_entry(
        self, shift, cashier,
    ):
        movement = billing_services.record_cash_movement(
            shift=shift, movement_type=CashMovementType.BANK_DEPOSIT,
            amount=Decimal("120.00"), reason="afternoon banking run",
            created_by=cashier,
        )
        assert billing_services.expected_cash(shift) == Decimal("80.00")
        entry = movement.journal_entry
        assert entry.lines.get(account=AccountMap.resolve("BANK_DEFAULT")).debit == Decimal("120.00")
        assert entry.lines.get(account=AccountMap.resolve("CASH_DEFAULT")).credit == Decimal("120.00")

    def test_a_reason_is_required(self, shift, cashier):
        with pytest.raises(ValidationError):
            billing_services.record_cash_movement(
                shift=shift, movement_type=CashMovementType.FLOAT_IN,
                amount=Decimal("10.00"), reason="", created_by=cashier,
            )

    def test_a_zero_or_negative_amount_is_refused(self, shift, cashier):
        with pytest.raises(ValidationError):
            billing_services.record_cash_movement(
                shift=shift, movement_type=CashMovementType.FLOAT_IN,
                amount=Decimal("0.00"), reason="x", created_by=cashier,
            )

    def test_a_movement_on_a_closed_shift_is_refused(self, shift, cashier):
        billing_services.close_shift(shift=shift, counted_amount=Decimal("200.00"), closed_by=cashier)
        with pytest.raises(ValidationError):
            billing_services.record_cash_movement(
                shift=shift, movement_type=CashMovementType.BANK_DEPOSIT,
                amount=Decimal("10.00"), reason="x", created_by=cashier,
            )

    def test_reason_is_required_at_the_database_level(self, shift, cashier):
        with pytest.raises(IntegrityError):
            with db_transaction.atomic():
                CashMovement.objects.create(
                    shift=shift, movement_type=CashMovementType.FLOAT_IN,
                    amount=Decimal("10.00"), reason="", created_by=cashier,
                )


class TestCashMovementImmutability:
    def test_a_cash_movement_cannot_be_deleted(self, shift, cashier):
        movement = billing_services.record_cash_movement(
            shift=shift, movement_type=CashMovementType.FLOAT_IN,
            amount=Decimal("10.00"), reason="x", created_by=cashier,
        )
        with pytest.raises(CashMovementImmutableError):
            movement.delete()


class TestTrialBalanceAfterCashMovements:
    def test_trial_balance_is_zero_after_opening_float_and_movements(self, cashier):
        shift = billing_services.open_shift(
            cashier=cashier, till_id="CM-tb", opening_float=Decimal("400.00"),
        )
        billing_services.record_cash_movement(
            shift=shift, movement_type=CashMovementType.BANK_DEPOSIT,
            amount=Decimal("100.00"), reason="banking run", created_by=cashier,
        )
        billing_services.record_cash_movement(
            shift=shift, movement_type=CashMovementType.FLOAT_IN,
            amount=Decimal("25.00"), reason="top-up", created_by=cashier,
        )
        tb = accounting_services.trial_balance()
        assert tb["is_balanced"]


class TestCashMovementAPI:
    def test_a_cashier_can_log_a_movement_on_their_own_shift(self, api, shift, cashier):
        api.force_authenticate(cashier)
        resp = api.post(reverse("cash-movement-list"), {
            "shift": shift.id, "movement_type": "FLOAT_IN",
            "amount": "30.00", "reason": "top-up",
        }, format="json", headers=_idem())
        assert resp.status_code == 201
        assert resp.data["created_by"] == cashier.id

    def test_a_cashier_cannot_log_a_movement_on_someone_elses_shift(
        self, api, shift, other_cashier,
    ):
        api.force_authenticate(other_cashier)
        resp = api.post(reverse("cash-movement-list"), {
            "shift": shift.id, "movement_type": "FLOAT_IN",
            "amount": "30.00", "reason": "top-up",
        }, format="json", headers=_idem())
        assert resp.status_code == 403

    def test_a_manager_can_log_a_movement_on_any_shift(self, api, shift, manager):
        api.force_authenticate(manager)
        resp = api.post(reverse("cash-movement-list"), {
            "shift": shift.id, "movement_type": "BANK_DEPOSIT",
            "amount": "50.00", "reason": "end of day banking",
        }, format="json", headers=_idem())
        assert resp.status_code == 201

    def test_a_patient_cannot_log_a_movement(self, api, shift, patient):
        api.force_authenticate(patient)
        resp = api.post(reverse("cash-movement-list"), {
            "shift": shift.id, "movement_type": "FLOAT_IN",
            "amount": "30.00", "reason": "top-up",
        }, format="json", headers=_idem())
        assert resp.status_code == 403

    def test_missing_idempotency_key_is_400(self, api, shift, cashier):
        api.force_authenticate(cashier)
        resp = api.post(reverse("cash-movement-list"), {
            "shift": shift.id, "movement_type": "FLOAT_IN",
            "amount": "30.00", "reason": "top-up",
        }, format="json")
        assert resp.status_code == 400
        assert not CashMovement.objects.filter(shift=shift).exists()

    def test_a_cashier_only_sees_movements_on_their_own_shifts(
        self, api, shift, cashier, other_cashier,
    ):
        billing_services.record_cash_movement(
            shift=shift, movement_type=CashMovementType.FLOAT_IN,
            amount=Decimal("10.00"), reason="x", created_by=cashier,
        )
        api.force_authenticate(other_cashier)
        resp = api.get(reverse("cash-movement-list"))
        assert resp.status_code == 200
        assert resp.data["count"] == 0
