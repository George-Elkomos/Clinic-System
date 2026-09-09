"""Financial roadmap Task 6 — wiring apps/billing into apps/accounting.

The chart of accounts + an open Period covering "today" are seeded once for
the whole test session (see tests/conftest.py's django_db_setup override).
"""
from decimal import Decimal

import pytest
from django.db.models import Sum

from apps.accounting import services as accounting_services
from apps.accounting.models import AccountMap, JournalEntry
from apps.appointments import services as appointment_services
from apps.billing import services as billing_services
from apps.billing.models import Invoice, InvoiceItem, ServiceItem
from apps.core.enums import PaymentMethod, RoleChoices, ServiceItemType

pytestmark = pytest.mark.django_db


@pytest.fixture
def consultation_item():
    return ServiceItem.objects.create(
        name="General Consultation", item_type=ServiceItemType.CONSULTATION,
        default_price=Decimal("50.00"),
    )


@pytest.fixture
def secretary(make_user):
    return make_user("acct-secretary@test.dev", RoleChoices.SECRETARY)


def _complete_visit(patient, doctor_profile, secretary):
    appointment = appointment_services.create_walk_in(
        patient=patient.patient_profile, doctor=doctor_profile, created_by=secretary,
    )
    return appointment_services.complete_appointment(appointment, user=secretary)


class TestInvoiceIssuePosting:
    def test_completing_a_visit_posts_a_balanced_entry(
        self, consultation_item, patient, doctor_profile, secretary,
    ):
        _complete_visit(patient, doctor_profile, secretary)
        invoice = Invoice.objects.get(patient=patient)

        entry = JournalEntry.objects.get(idempotency_key=f"Invoice:{invoice.id}:issue")
        lines = list(entry.lines.all())
        total_debit = sum((line.debit for line in lines), Decimal("0.00"))
        total_credit = sum((line.credit for line in lines), Decimal("0.00"))
        assert total_debit == total_credit == invoice.total

    def test_ar_patient_debited_and_revenue_credited(
        self, consultation_item, patient, doctor_profile, secretary,
    ):
        _complete_visit(patient, doctor_profile, secretary)
        invoice = Invoice.objects.get(patient=patient)
        entry = JournalEntry.objects.get(idempotency_key=f"Invoice:{invoice.id}:issue")

        ar_account = AccountMap.resolve("AR_PATIENT")
        revenue_account = AccountMap.resolve("REVENUE_BY_SERVICE_CATEGORY", "CONSULTATION")

        ar_line = entry.lines.get(account=ar_account)
        assert ar_line.debit == invoice.total
        assert ar_line.party_type == "Patient"
        assert ar_line.party_id == patient.id

        revenue_line = entry.lines.get(account=revenue_account)
        assert revenue_line.credit == Decimal("50.00")
        assert revenue_line.doctor_id == doctor_profile.user_id

    def test_discount_posts_as_its_own_line_not_netted(self, patient, doctor_profile, secretary):
        item = ServiceItem.objects.create(
            name="Consult", item_type=ServiceItemType.CONSULTATION, default_price=Decimal("100.00"),
        )
        invoice = Invoice.objects.create(patient=patient, doctor=doctor_profile.user)
        InvoiceItem.objects.create(
            invoice=invoice, description=item.name, service_item=item,
            quantity=1, unit_price=item.default_price,
        )
        invoice.discount = Decimal("15.00")
        invoice.recalculate_totals()
        assert invoice.total == Decimal("85.00")

        entry = billing_services.post_invoice_issued(invoice, user=secretary)

        discount_account = AccountMap.resolve("DISCOUNT")
        revenue_account = AccountMap.resolve("REVENUE_BY_SERVICE_CATEGORY", "CONSULTATION")
        ar_account = AccountMap.resolve("AR_PATIENT")

        assert entry.lines.get(account=revenue_account).credit == Decimal("100.00")  # gross
        assert entry.lines.get(account=discount_account).debit == Decimal("15.00")
        assert entry.lines.get(account=ar_account).debit == Decimal("85.00")  # net owed
        total_debit = sum((l.debit for l in entry.lines.all()), Decimal("0.00"))
        total_credit = sum((l.credit for l in entry.lines.all()), Decimal("0.00"))
        assert total_debit == total_credit == Decimal("100.00")


class TestPaymentPosting:
    @pytest.fixture
    def issued_invoice(self, consultation_item, patient, doctor_profile, secretary):
        _complete_visit(patient, doctor_profile, secretary)
        return Invoice.objects.get(patient=patient)

    @pytest.mark.parametrize("method,purpose,qualifier", [
        (PaymentMethod.CASH, "CASH_DEFAULT", ""),
        (PaymentMethod.CARD, "GATEWAY_CLEARING", "CARD"),
        (PaymentMethod.BANK_TRANSFER, "BANK_DEFAULT", ""),
    ])
    def test_payment_posts_a_balanced_entry_with_the_right_cash_account(
        self, issued_invoice, secretary, method, purpose, qualifier,
    ):
        payment = billing_services.record_payment(
            invoice=issued_invoice, amount=issued_invoice.total,
            payment_method=method, received_by=secretary,
        )
        entry = JournalEntry.objects.get(idempotency_key=f"Payment:{payment.id}:receipt")
        lines = list(entry.lines.all())
        total_debit = sum((l.debit for l in lines), Decimal("0.00"))
        total_credit = sum((l.credit for l in lines), Decimal("0.00"))
        assert total_debit == total_credit == payment.amount

        cash_account = AccountMap.resolve(purpose, qualifier)
        assert entry.lines.get(account=cash_account).debit == payment.amount

        ar_account = AccountMap.resolve("AR_PATIENT")
        ar_line = entry.lines.get(account=ar_account)
        assert ar_line.credit == payment.amount
        assert ar_line.party_id == issued_invoice.patient_id


class TestReconciliation:
    def test_ar_patient_balance_matches_open_invoice_balances(
        self, consultation_item, patient, doctor_profile, secretary,
    ):
        _complete_visit(patient, doctor_profile, secretary)
        invoice = Invoice.objects.get(patient=patient)
        billing_services.record_payment(
            invoice=invoice, amount=Decimal("20.00"),
            payment_method=PaymentMethod.CASH, received_by=secretary,
        )
        invoice.refresh_from_db()

        ar_account = AccountMap.resolve("AR_PATIENT")
        ledger_ar_balance = accounting_services.account_balance(ar_account)

        open_invoice_balance = (
            Invoice.objects.filter(patient=patient).aggregate(total=Sum("balance"))["total"]
            or Decimal("0.00")
        )

        assert ledger_ar_balance == open_invoice_balance == invoice.balance

    def test_full_scenario_trial_balance_is_zero(
        self, consultation_item, patient, doctor_profile, secretary,
    ):
        _complete_visit(patient, doctor_profile, secretary)
        invoice = Invoice.objects.get(patient=patient)
        billing_services.record_payment(
            invoice=invoice, amount=invoice.total,
            payment_method=PaymentMethod.CARD, received_by=secretary,
        )

        tb = accounting_services.trial_balance()
        assert tb["is_balanced"] is True
        assert tb["total_debit"] == tb["total_credit"]

    def test_free_followup_posts_nothing(self, consultation_item, patient, doctor_profile, secretary):
        _complete_visit(patient, doctor_profile, secretary)  # opens the window
        before = JournalEntry.objects.count()
        _complete_visit(patient, doctor_profile, secretary)  # consumes the free visit
        assert JournalEntry.objects.count() == before  # no new entry posted
