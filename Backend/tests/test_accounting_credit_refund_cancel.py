"""Financial roadmap Task 7 — credit notes, refunds, cancellation, deposits.

The chart of accounts + an open Period covering "today" are seeded once for
the whole test session (see tests/conftest.py's django_db_setup override).
"""
from decimal import Decimal

import pytest
from django.db import IntegrityError
from django.db import transaction as db_transaction
from rest_framework.exceptions import ValidationError

from apps.accounting import services as accounting_services
from apps.accounting.models import AccountMap, JournalEntry
from apps.appointments import services as appointment_services
from apps.billing import services as billing_services
from apps.billing.models import CreditNote, Invoice, PatientDeposit, Refund, ServiceItem
from apps.core.enums import PaymentMethod, RoleChoices, ServiceItemType

pytestmark = pytest.mark.django_db


@pytest.fixture
def consultation_item():
    return ServiceItem.objects.create(
        name="General Consultation", item_type=ServiceItemType.CONSULTATION,
        default_price=Decimal("100.00"),
    )


@pytest.fixture
def secretary(make_user):
    return make_user("cr-secretary@test.dev", RoleChoices.SECRETARY)


@pytest.fixture
def manager(make_user):
    return make_user("cr-manager@test.dev", RoleChoices.MANAGER)


def _complete_visit(patient, doctor_profile, secretary):
    appointment = appointment_services.create_walk_in(
        patient=patient.patient_profile, doctor=doctor_profile, created_by=secretary,
    )
    return appointment_services.complete_appointment(appointment, user=secretary)


def _issued_invoice(consultation_item, patient, doctor_profile, secretary):
    _complete_visit(patient, doctor_profile, secretary)
    return Invoice.objects.get(patient=patient)  # total 100.00


class TestCreditNote:
    def test_partial_credit_note_posts_and_reduces_balance(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        note = billing_services.issue_credit_note(
            invoice=invoice, amount=Decimal("30.00"),
            reason_code="goodwill_adjustment", approved_by=manager,
        )
        invoice.refresh_from_db()
        assert invoice.credited_amount == Decimal("30.00")
        assert invoice.balance == Decimal("70.00")

        entry = note.journal_entry
        assert entry is not None
        lines = list(entry.lines.all())
        total_debit = sum((l.debit for l in lines), Decimal("0.00"))
        total_credit = sum((l.credit for l in lines), Decimal("0.00"))
        assert total_debit == total_credit == Decimal("30.00")

        ar_account = AccountMap.resolve("AR_PATIENT")
        assert entry.lines.get(account=ar_account).credit == Decimal("30.00")

    def test_full_credit_note_zeroes_the_balance(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        billing_services.issue_credit_note(
            invoice=invoice, amount=invoice.total, reason_code="full_void", approved_by=manager,
        )
        invoice.refresh_from_db()
        assert invoice.balance == Decimal("0.00")

    def test_credit_note_cannot_exceed_remaining_creditable_amount(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        with pytest.raises(ValidationError):
            billing_services.issue_credit_note(
                invoice=invoice, amount=Decimal("150.00"),
                reason_code="too_much", approved_by=manager,
            )

    def test_credit_note_requires_a_reason_code(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        with pytest.raises(ValidationError):
            billing_services.issue_credit_note(
                invoice=invoice, amount=Decimal("10.00"), reason_code="", approved_by=manager,
            )

    def test_reason_code_is_mandatory_at_the_database_level(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        with pytest.raises(IntegrityError):
            with db_transaction.atomic():
                CreditNote.objects.create(
                    invoice=invoice, amount=Decimal("10.00"), reason_code="", approved_by=manager,
                )

    def test_two_partial_credit_notes_stack_correctly(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        billing_services.issue_credit_note(
            invoice=invoice, amount=Decimal("20.00"), reason_code="first", approved_by=manager,
        )
        billing_services.issue_credit_note(
            invoice=invoice, amount=Decimal("15.00"), reason_code="second", approved_by=manager,
        )
        invoice.refresh_from_db()
        assert invoice.credited_amount == Decimal("35.00")
        assert invoice.balance == Decimal("65.00")


class TestRefund:
    def test_refund_posts_a_balanced_entry(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        billing_services.record_payment(
            invoice=invoice, amount=invoice.total,
            payment_method=PaymentMethod.CASH, received_by=secretary,
        )
        refund = billing_services.issue_refund(
            invoice=invoice, amount=Decimal("40.00"), payment_method=PaymentMethod.CASH,
            reason_code="patient_requested", approved_by=manager,
        )
        invoice.refresh_from_db()
        assert invoice.refunded_amount == Decimal("40.00")
        assert invoice.balance == Decimal("40.00")  # owed again

        entry = refund.journal_entry
        lines = list(entry.lines.all())
        total_debit = sum((l.debit for l in lines), Decimal("0.00"))
        total_credit = sum((l.credit for l in lines), Decimal("0.00"))
        assert total_debit == total_credit == Decimal("40.00")

    def test_refund_cannot_exceed_what_was_collected(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        billing_services.record_payment(
            invoice=invoice, amount=Decimal("30.00"),
            payment_method=PaymentMethod.CASH, received_by=secretary,
        )
        with pytest.raises(ValidationError):
            billing_services.issue_refund(
                invoice=invoice, amount=Decimal("50.00"), payment_method=PaymentMethod.CASH,
                reason_code="too_much", approved_by=manager,
            )

    def test_a_second_refund_cannot_exceed_the_remaining_collected_amount(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        billing_services.record_payment(
            invoice=invoice, amount=invoice.total,
            payment_method=PaymentMethod.CASH, received_by=secretary,
        )
        billing_services.issue_refund(
            invoice=invoice, amount=Decimal("60.00"), payment_method=PaymentMethod.CASH,
            reason_code="first_refund", approved_by=manager,
        )
        with pytest.raises(ValidationError):
            billing_services.issue_refund(
                invoice=invoice, amount=Decimal("50.00"), payment_method=PaymentMethod.CASH,
                reason_code="second_refund_too_much", approved_by=manager,
            )

    def test_refund_requires_a_reason_code(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        billing_services.record_payment(
            invoice=invoice, amount=invoice.total,
            payment_method=PaymentMethod.CASH, received_by=secretary,
        )
        with pytest.raises(ValidationError):
            billing_services.issue_refund(
                invoice=invoice, amount=Decimal("10.00"), payment_method=PaymentMethod.CASH,
                reason_code="", approved_by=manager,
            )

    def test_reason_code_is_mandatory_at_the_database_level(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        with pytest.raises(IntegrityError):
            with db_transaction.atomic():
                Refund.objects.create(
                    invoice=invoice, amount=Decimal("10.00"), payment_method=PaymentMethod.CASH,
                    reason_code="", approved_by=manager,
                )


class TestOverpaymentDeposit:
    def test_overpayment_creates_a_liability_not_revenue(
        self, consultation_item, patient, doctor_profile, secretary,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        billing_services.record_payment(
            invoice=invoice, amount=Decimal("150.00"),
            payment_method=PaymentMethod.CASH, received_by=secretary,
        )
        invoice.refresh_from_db()
        assert invoice.status == "PAID"
        assert invoice.balance == Decimal("0.00")

        deposit = PatientDeposit.objects.get(patient=patient)
        assert deposit.amount == Decimal("50.00")
        assert deposit.available_amount == Decimal("50.00")

        deposit_account = AccountMap.resolve("PATIENT_CREDIT_BALANCE")
        assert deposit_account.root_type == "LIABILITY"
        assert accounting_services.account_balance(deposit_account) == Decimal("-50.00")  # credit balance


class TestCancellation:
    def test_cancelling_an_unpaid_invoice_reverses_the_entry(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        original_entry = JournalEntry.objects.get(idempotency_key=f"Invoice:{invoice.id}:issue")

        billing_services.cancel_invoice(
            invoice=invoice, reason_code="booked_in_error", cancelled_by=manager,
        )
        invoice.refresh_from_db()
        assert invoice.status == "CANCELLED"
        assert invoice.balance == Decimal("0.00")

        # The original entry is completely untouched.
        original_entry.refresh_from_db()
        assert original_entry.reverses_id is None

        reversal = JournalEntry.objects.get(
            idempotency_key=f"Invoice:{invoice.id}:issue:reverse",
        )
        assert reversal.reverses_id == original_entry.pk

    def test_cancelling_an_invoice_with_payments_is_refused(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        billing_services.record_payment(
            invoice=invoice, amount=Decimal("20.00"),
            payment_method=PaymentMethod.CASH, received_by=secretary,
        )
        with pytest.raises(ValidationError):
            billing_services.cancel_invoice(
                invoice=invoice, reason_code="try_cancel", cancelled_by=manager,
            )

    def test_cancelling_twice_is_refused(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        billing_services.cancel_invoice(
            invoice=invoice, reason_code="first_cancel", cancelled_by=manager,
        )
        with pytest.raises(ValidationError):
            billing_services.cancel_invoice(
                invoice=invoice, reason_code="second_cancel", cancelled_by=manager,
            )

    def test_cancellation_requires_a_reason_code(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        with pytest.raises(ValidationError):
            billing_services.cancel_invoice(invoice=invoice, reason_code="", cancelled_by=manager)


class TestTrialBalanceAfterEveryScenario:
    def test_credit_note_scenario(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        billing_services.issue_credit_note(
            invoice=invoice, amount=Decimal("25.00"), reason_code="test", approved_by=manager,
        )
        tb = accounting_services.trial_balance()
        assert tb["is_balanced"] is True

    def test_refund_scenario(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        billing_services.record_payment(
            invoice=invoice, amount=invoice.total,
            payment_method=PaymentMethod.BANK_TRANSFER, received_by=secretary,
        )
        billing_services.issue_refund(
            invoice=invoice, amount=Decimal("30.00"), payment_method=PaymentMethod.BANK_TRANSFER,
            reason_code="test", approved_by=manager,
        )
        tb = accounting_services.trial_balance()
        assert tb["is_balanced"] is True

    def test_overpayment_scenario(self, consultation_item, patient, doctor_profile, secretary):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        billing_services.record_payment(
            invoice=invoice, amount=Decimal("175.00"),
            payment_method=PaymentMethod.CARD, received_by=secretary,
        )
        tb = accounting_services.trial_balance()
        assert tb["is_balanced"] is True

    def test_cancellation_scenario(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        billing_services.cancel_invoice(
            invoice=invoice, reason_code="test", cancelled_by=manager,
        )
        tb = accounting_services.trial_balance()
        assert tb["is_balanced"] is True
