"""Financial roadmap Task 11 — cashier shifts and the posted till variance.

The chart of accounts + an open Period covering "today" are seeded once for
the whole test session (see tests/conftest.py's django_db_setup override).

The point of this task is the last two words: the difference between the
counted drawer and what the ledger expects is *posted*, not merely recorded
in a column — so most of these tests end by looking at the journal entry.
"""
from decimal import Decimal

import pytest
from django.db import IntegrityError
from django.db import transaction as db_transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.accounting import services as accounting_services
from apps.accounting.models import AccountMap, JournalEntry
from apps.appointments import services as appointment_services
from apps.billing import services as billing_services
from apps.billing.exceptions import ClosedShiftError
from apps.billing.models import CashierShift, Invoice, ServiceItem
from apps.core.enums import CashierShiftStatus, PaymentMethod, RoleChoices, ServiceItemType

pytestmark = pytest.mark.django_db


@pytest.fixture
def consultation_item():
    return ServiceItem.objects.create(
        name="General Consultation", item_type=ServiceItemType.CONSULTATION,
        default_price=Decimal("100.00"),
    )


@pytest.fixture
def cashier(make_user):
    return make_user("shift-cashier@test.dev", RoleChoices.SECRETARY)


@pytest.fixture
def other_cashier(make_user):
    return make_user("shift-cashier2@test.dev", RoleChoices.SECRETARY)


@pytest.fixture
def manager(make_user):
    return make_user("shift-manager@test.dev", RoleChoices.MANAGER)


@pytest.fixture
def shift(cashier):
    return billing_services.open_shift(
        cashier=cashier, till_id="T1", opening_float=Decimal("200.00"),
    )


def _issued_invoice(patient, doctor_profile, secretary):
    """A visit billed at 100.00."""
    appointment = appointment_services.create_walk_in(
        patient=patient.patient_profile, doctor=doctor_profile, created_by=secretary,
    )
    appointment_services.complete_appointment(appointment, user=secretary)
    return Invoice.objects.get(patient=patient)


def _entry_amount(entry):
    lines = list(entry.lines.all())
    debit = sum((line.debit for line in lines), Decimal("0.00"))
    credit = sum((line.credit for line in lines), Decimal("0.00"))
    assert debit == credit  # zero tolerance
    return debit


class TestOpenShift:
    def test_open_shift_records_the_float_and_starts_open(self, cashier):
        opened = billing_services.open_shift(
            cashier=cashier, till_id="T1", opening_float=Decimal("150.00"),
        )
        assert opened.status == CashierShiftStatus.OPEN
        assert opened.opening_float == Decimal("150.00")
        assert opened.closed_at is None
        assert opened.variance is None
        assert billing_services.current_shift(cashier) == opened

    def test_opening_float_defaults_to_zero(self, cashier):
        assert billing_services.open_shift(cashier=cashier).opening_float == Decimal("0.00")

    def test_a_negative_opening_float_is_refused(self, cashier):
        with pytest.raises(ValidationError):
            billing_services.open_shift(cashier=cashier, opening_float=Decimal("-1.00"))

    def test_a_cashier_cannot_have_two_open_shifts(self, shift, cashier):
        with pytest.raises(ValidationError):
            billing_services.open_shift(cashier=cashier, till_id="T2")

    def test_a_till_cannot_have_two_open_shifts(self, shift, other_cashier):
        with pytest.raises(ValidationError):
            billing_services.open_shift(cashier=other_cashier, till_id="T1")

    def test_one_open_shift_per_cashier_is_enforced_by_the_database(self, shift, cashier):
        with pytest.raises(IntegrityError):
            with db_transaction.atomic():
                CashierShift.objects.create(cashier=cashier, till_id="T9")

    def test_one_open_shift_per_till_is_enforced_by_the_database(self, shift, other_cashier):
        with pytest.raises(IntegrityError):
            with db_transaction.atomic():
                CashierShift.objects.create(cashier=other_cashier, till_id="T1")

    def test_a_till_can_be_reopened_once_the_previous_shift_is_closed(self, shift, cashier):
        billing_services.close_shift(
            shift=shift, counted_amount=Decimal("200.00"), closed_by=cashier,
        )
        reopened = billing_services.open_shift(
            cashier=cashier, till_id="T1", opening_float=Decimal("200.00"),
        )
        assert reopened.pk != shift.pk


class TestExpectedCash:
    def test_payments_taken_during_a_shift_are_stamped_with_it(
        self, consultation_item, patient, doctor_profile, secretary, shift, cashier,
    ):
        invoice = _issued_invoice(patient, doctor_profile, secretary)
        payment = billing_services.record_payment(
            invoice=invoice, amount=Decimal("100.00"),
            payment_method=PaymentMethod.CASH, received_by=cashier,
        )
        assert payment.shift == shift

    def test_a_payment_with_no_open_shift_is_still_taken(
        self, consultation_item, patient, doctor_profile, secretary,
    ):
        invoice = _issued_invoice(patient, doctor_profile, secretary)
        payment = billing_services.record_payment(
            invoice=invoice, amount=Decimal("100.00"),
            payment_method=PaymentMethod.CASH, received_by=secretary,
        )
        assert payment.shift is None
        assert payment.amount == Decimal("100.00")

    def test_expected_cash_is_float_plus_cash_received(
        self, consultation_item, patient, doctor_profile, secretary, shift, cashier,
    ):
        invoice = _issued_invoice(patient, doctor_profile, secretary)
        billing_services.record_payment(
            invoice=invoice, amount=Decimal("60.00"),
            payment_method=PaymentMethod.CASH, received_by=cashier,
        )
        billing_services.record_payment(
            invoice=invoice, amount=Decimal("40.00"),
            payment_method=PaymentMethod.CASH, received_by=cashier,
        )
        assert billing_services.expected_cash(shift) == Decimal("300.00")

    def test_card_payments_never_reach_the_drawer(
        self, consultation_item, patient, doctor_profile, secretary, shift, cashier,
    ):
        invoice = _issued_invoice(patient, doctor_profile, secretary)
        payment = billing_services.record_payment(
            invoice=invoice, amount=Decimal("100.00"),
            payment_method=PaymentMethod.CARD, received_by=cashier,
        )
        assert payment.shift == shift  # still part of the session's record
        assert billing_services.expected_cash(shift) == Decimal("200.00")

    def test_a_cash_refund_takes_money_out_of_the_drawer(
        self, consultation_item, patient, doctor_profile, secretary, shift, cashier, manager,
    ):
        invoice = _issued_invoice(patient, doctor_profile, secretary)
        billing_services.record_payment(
            invoice=invoice, amount=Decimal("100.00"),
            payment_method=PaymentMethod.CASH, received_by=cashier,
        )
        refund = billing_services.issue_refund(
            invoice=invoice, amount=Decimal("25.00"),
            payment_method=PaymentMethod.CASH, reason_code="patient_left",
            approved_by=manager, shift=shift,
        )
        assert refund.shift == shift
        assert billing_services.expected_cash(shift) == Decimal("275.00")

    def test_a_refund_is_attributed_to_the_payer_not_the_approver(
        self, consultation_item, patient, doctor_profile, secretary, shift, cashier, manager,
    ):
        """The manager approves from their own till; the cashier hands over the
        cash. The money must come off the cashier's drawer, not the manager's."""
        manager_shift = billing_services.open_shift(
            cashier=manager, till_id="T2", opening_float=Decimal("500.00"),
        )
        invoice = _issued_invoice(patient, doctor_profile, secretary)
        billing_services.record_payment(
            invoice=invoice, amount=Decimal("100.00"),
            payment_method=PaymentMethod.CASH, received_by=cashier,
        )
        refund = billing_services.issue_refund(
            invoice=invoice, amount=Decimal("30.00"),
            payment_method=PaymentMethod.CASH, reason_code="overcharge",
            approved_by=manager, paid_by=cashier,
        )
        assert refund.shift == shift
        assert billing_services.expected_cash(shift) == Decimal("270.00")
        assert billing_services.expected_cash(manager_shift) == Decimal("500.00")

    def test_a_refund_with_no_payer_is_left_unattributed(
        self, consultation_item, patient, doctor_profile, secretary, shift, cashier, manager,
    ):
        """Never guess the drawer from the approver: an unattributed refund is
        a truthful gap, a wrongly attributed one corrupts two counts at once."""
        manager_shift = billing_services.open_shift(
            cashier=manager, till_id="T2", opening_float=Decimal("500.00"),
        )
        invoice = _issued_invoice(patient, doctor_profile, secretary)
        billing_services.record_payment(
            invoice=invoice, amount=Decimal("100.00"),
            payment_method=PaymentMethod.CASH, received_by=cashier,
        )
        refund = billing_services.issue_refund(
            invoice=invoice, amount=Decimal("30.00"),
            payment_method=PaymentMethod.CASH, reason_code="overcharge",
            approved_by=manager,
        )
        assert refund.shift is None
        assert billing_services.expected_cash(manager_shift) == Decimal("500.00")

    def test_money_cannot_be_stamped_onto_a_closed_shift(
        self, consultation_item, patient, doctor_profile, secretary, shift, cashier,
    ):
        billing_services.close_shift(
            shift=shift, counted_amount=Decimal("200.00"), closed_by=cashier,
        )
        invoice = _issued_invoice(patient, doctor_profile, secretary)
        with pytest.raises(ValidationError):
            billing_services.record_payment(
                invoice=invoice, amount=Decimal("100.00"),
                payment_method=PaymentMethod.CASH, received_by=cashier, shift=shift,
            )


class TestCloseShift:
    def test_an_exact_count_closes_with_no_posting(
        self, consultation_item, patient, doctor_profile, secretary, shift, cashier,
    ):
        invoice = _issued_invoice(patient, doctor_profile, secretary)
        billing_services.record_payment(
            invoice=invoice, amount=Decimal("100.00"),
            payment_method=PaymentMethod.CASH, received_by=cashier,
        )
        closed = billing_services.close_shift(
            shift=shift, counted_amount=Decimal("300.00"), closed_by=cashier,
        )
        assert closed.status == CashierShiftStatus.CLOSED
        assert closed.expected_amount == Decimal("300.00")
        assert closed.counted_amount == Decimal("300.00")
        assert closed.variance == Decimal("0.00")
        assert closed.journal_entry is None
        assert closed.closed_at is not None
        assert closed.closed_by == cashier
        assert not JournalEntry.objects.filter(
            idempotency_key=f"Shift:{shift.id}:variance"
        ).exists()

    def test_an_over_debits_cash_and_credits_the_variance_account(
        self, shift, cashier, manager,
    ):
        closed = billing_services.close_shift(
            shift=shift, counted_amount=Decimal("215.00"), closed_by=cashier,
            reason_code="unexplained_over", approved_by=manager,
        )
        assert closed.variance == Decimal("15.00")

        entry = closed.journal_entry
        assert entry is not None
        assert entry.reason_code == "unexplained_over"
        assert _entry_amount(entry) == Decimal("15.00")
        assert entry.lines.get(
            account=AccountMap.resolve("CASH_DEFAULT")
        ).debit == Decimal("15.00")
        assert entry.lines.get(
            account=AccountMap.resolve("CASH_VARIANCE")
        ).credit == Decimal("15.00")

    def test_a_short_debits_the_variance_account_and_credits_cash(
        self, shift, cashier, manager,
    ):
        closed = billing_services.close_shift(
            shift=shift, counted_amount=Decimal("180.00"), closed_by=cashier,
            reason_code="till_short", approved_by=manager,
        )
        assert closed.variance == Decimal("-20.00")

        entry = closed.journal_entry
        assert _entry_amount(entry) == Decimal("20.00")
        assert entry.lines.get(
            account=AccountMap.resolve("CASH_VARIANCE")
        ).debit == Decimal("20.00")
        assert entry.lines.get(
            account=AccountMap.resolve("CASH_DEFAULT")
        ).credit == Decimal("20.00")

    def test_the_posted_cash_account_is_the_one_payments_debit(
        self, consultation_item, patient, doctor_profile, secretary, shift, cashier, manager,
    ):
        """A variance must land on the account the cash it explains sits in."""
        invoice = _issued_invoice(patient, doctor_profile, secretary)
        payment = billing_services.record_payment(
            invoice=invoice, amount=Decimal("100.00"),
            payment_method=PaymentMethod.CASH, received_by=cashier,
        )
        receipt = JournalEntry.objects.get(idempotency_key=f"Payment:{payment.id}:receipt")
        receipt_cash_line = receipt.lines.exclude(debit=Decimal("0.00")).get()

        closed = billing_services.close_shift(
            shift=shift, counted_amount=Decimal("295.00"), closed_by=cashier,
            reason_code="till_short", approved_by=manager,
        )
        variance_cash_line = closed.journal_entry.lines.exclude(credit=Decimal("0.00")).get()
        assert variance_cash_line.account_id == receipt_cash_line.account_id

    def test_a_variance_needs_a_reason_code(self, shift, cashier, manager):
        with pytest.raises(ValidationError):
            billing_services.close_shift(
                shift=shift, counted_amount=Decimal("190.00"), closed_by=cashier,
                approved_by=manager,
            )
        shift.refresh_from_db()
        assert shift.status == CashierShiftStatus.OPEN  # nothing half-done

    def test_a_variance_needs_an_approver(self, shift, cashier):
        with pytest.raises(ValidationError):
            billing_services.close_shift(
                shift=shift, counted_amount=Decimal("190.00"), closed_by=cashier,
                reason_code="till_short",
            )

    def test_a_negative_count_is_refused(self, shift, cashier, manager):
        with pytest.raises(ValidationError):
            billing_services.close_shift(
                shift=shift, counted_amount=Decimal("-1.00"), closed_by=cashier,
                reason_code="nonsense", approved_by=manager,
            )

    def test_a_shift_cannot_be_closed_twice(self, shift, cashier):
        billing_services.close_shift(
            shift=shift, counted_amount=Decimal("200.00"), closed_by=cashier,
        )
        with pytest.raises(ValidationError):
            billing_services.close_shift(
                shift=shift, counted_amount=Decimal("200.00"), closed_by=cashier,
            )

    def test_variance_posting_is_idempotent(self, shift, cashier, manager):
        closed = billing_services.close_shift(
            shift=shift, counted_amount=Decimal("210.00"), closed_by=cashier,
            reason_code="unexplained_over", approved_by=manager,
        )
        again = billing_services.post_shift_variance(
            closed, variance=Decimal("10.00"),
            reason_code="unexplained_over", user=manager,
        )
        assert again == closed.journal_entry
        assert JournalEntry.objects.filter(
            idempotency_key=f"Shift:{shift.id}:variance"
        ).count() == 1


class TestClosedShiftIsImmutable:
    def test_a_reason_code_and_approver_are_mandatory_at_the_database_level(self, cashier):
        with pytest.raises(IntegrityError):
            with db_transaction.atomic():
                CashierShift.objects.create(
                    cashier=cashier, till_id="T-DB", status=CashierShiftStatus.CLOSED,
                    closed_at=timezone.now(),
                    expected_amount=Decimal("100.00"), counted_amount=Decimal("90.00"),
                    variance=Decimal("-10.00"),  # no reason_code, no approved_by
                )

    def test_a_closed_shift_must_carry_its_whole_count(self, cashier):
        with pytest.raises(IntegrityError):
            with db_transaction.atomic():
                CashierShift.objects.create(
                    cashier=cashier, till_id="T-DB2", status=CashierShiftStatus.CLOSED,
                )

    def test_a_closed_shift_cannot_be_edited(self, shift, cashier):
        closed = billing_services.close_shift(
            shift=shift, counted_amount=Decimal("200.00"), closed_by=cashier,
        )
        closed.counted_amount = Decimal("999.00")
        with pytest.raises(ClosedShiftError):
            closed.save(update_fields=["counted_amount"])

    def test_a_shift_cannot_be_deleted(self, shift):
        with pytest.raises(ClosedShiftError):
            shift.delete()


class TestTrialBalance:
    def test_trial_balance_is_zero_after_a_shift_with_a_variance(
        self, consultation_item, patient, doctor_profile, secretary, shift, cashier, manager,
    ):
        invoice = _issued_invoice(patient, doctor_profile, secretary)
        billing_services.record_payment(
            invoice=invoice, amount=Decimal("100.00"),
            payment_method=PaymentMethod.CASH, received_by=cashier,
        )
        billing_services.issue_refund(
            invoice=invoice, amount=Decimal("10.00"),
            payment_method=PaymentMethod.CASH, reason_code="overcharge",
            approved_by=manager, shift=shift,
        )
        billing_services.close_shift(
            shift=shift, counted_amount=Decimal("280.00"), closed_by=cashier,
            reason_code="till_short", approved_by=manager,
        )

        tb = accounting_services.trial_balance()
        assert tb["is_balanced"]
        assert tb["total_debit"] - tb["total_credit"] == Decimal("0.00")

    def test_the_cash_account_moves_by_exactly_the_variance(
        self, consultation_item, patient, doctor_profile, secretary, shift, cashier, manager,
    ):
        """After the variance is posted, the ledger's cash agrees with the count."""
        invoice = _issued_invoice(patient, doctor_profile, secretary)
        billing_services.record_payment(
            invoice=invoice, amount=Decimal("100.00"),
            payment_method=PaymentMethod.CASH, received_by=cashier,
        )
        cash_before = accounting_services.account_balance(AccountMap.resolve("CASH_DEFAULT"))
        closed = billing_services.close_shift(
            shift=shift, counted_amount=Decimal("293.00"), closed_by=cashier,
            reason_code="till_short", approved_by=manager,
        )
        cash_after = accounting_services.account_balance(AccountMap.resolve("CASH_DEFAULT"))
        assert closed.variance == Decimal("-7.00")
        assert cash_after == cash_before + closed.variance
