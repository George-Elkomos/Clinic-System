"""Financial roadmap Task 9 — financial reports.

Every report here must reconcile to the trial balance (the roadmap's own DoD
wording), and the ledger-derived figures must agree with the pre-existing
`apps.billing.services.billing_report()`.
"""
from decimal import Decimal

import pytest
from django.utils import timezone

from apps.accounting import reports as accounting_reports
from apps.accounting import services as accounting_services
from apps.billing import reports as billing_reports
from apps.billing import services as billing_services
from apps.billing.models import Invoice, ServiceItem
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
    return make_user("report-secretary@test.dev", RoleChoices.SECRETARY)


@pytest.fixture
def manager(make_user):
    return make_user("report-manager@test.dev", RoleChoices.MANAGER)


def _complete_visit(patient, doctor_profile, secretary):
    from apps.appointments import services as appointment_services

    appointment = appointment_services.create_walk_in(
        patient=patient.patient_profile, doctor=doctor_profile, created_by=secretary,
    )
    return appointment_services.complete_appointment(appointment, user=secretary)


class TestBalanceSheet:
    def test_balances_after_a_scenario(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        _complete_visit(patient, doctor_profile, secretary)
        invoice = Invoice.objects.get(patient=patient)
        billing_services.record_payment(
            invoice=invoice, amount=Decimal("60.00"),
            payment_method=PaymentMethod.CASH, received_by=secretary,
        )
        billing_services.issue_credit_note(
            invoice=invoice, amount=Decimal("10.00"), reason_code="test", approved_by=manager,
        )

        sheet = accounting_reports.balance_sheet()
        assert sheet["is_balanced"] is True
        assert sheet["total_assets"] == sheet["total_liabilities"] + sheet["total_equity"]

    def test_balances_with_zero_activity(self):
        sheet = accounting_reports.balance_sheet()
        assert sheet["is_balanced"] is True
        assert sheet["total_assets"] == Decimal("0.00")


class TestIncomeStatement:
    def test_agrees_with_billing_report_for_the_same_day(
        self, consultation_item, patient, doctor_profile, secretary,
    ):
        _complete_visit(patient, doctor_profile, secretary)
        today = timezone.localdate()

        statement = accounting_reports.income_statement(today, today)
        report = billing_services.billing_report(period="day")

        assert statement["total_revenue"] == report["total_billed"]

    def test_discount_reduces_revenue_in_the_statement(
        self, patient, doctor_profile, secretary,
    ):
        from apps.billing.models import Invoice as InvoiceModel
        from apps.billing.models import InvoiceItem

        item = ServiceItem.objects.create(
            name="Consult", item_type=ServiceItemType.CONSULTATION, default_price=Decimal("100.00"),
        )
        invoice = InvoiceModel.objects.create(patient=patient, doctor=doctor_profile.user)
        InvoiceItem.objects.create(
            invoice=invoice, description=item.name, service_item=item,
            quantity=1, unit_price=item.default_price,
        )
        invoice.discount = Decimal("20.00")
        invoice.recalculate_totals()
        billing_services.post_invoice_issued(invoice, user=secretary)

        today = timezone.localdate()
        statement = accounting_reports.income_statement(today, today)
        assert statement["total_revenue"] == Decimal("80.00")

    def test_net_income_is_revenue_minus_expenses_with_no_activity(self):
        today = timezone.localdate()
        statement = accounting_reports.income_statement(today, today)
        assert statement["net_income"] == statement["total_revenue"] - statement["total_expense"]


class TestArAgeing:
    def test_grand_total_matches_ledger_party_balances(
        self, consultation_item, patient, doctor_profile, secretary,
    ):
        _complete_visit(patient, doctor_profile, secretary)
        ageing = billing_reports.ar_ageing()

        assert len(ageing["rows"]) == 1
        row = ageing["rows"][0]
        assert row["patient_id"] == patient.id
        assert row["total"] == row["ledger_balance"] == Decimal("100.00")
        assert row["current"] == Decimal("100.00")
        assert ageing["grand_total"] == Decimal("100.00")

    def test_fully_paid_invoices_do_not_appear(
        self, consultation_item, patient, doctor_profile, secretary,
    ):
        _complete_visit(patient, doctor_profile, secretary)
        invoice = Invoice.objects.get(patient=patient)
        billing_services.record_payment(
            invoice=invoice, amount=invoice.total,
            payment_method=PaymentMethod.CASH, received_by=secretary,
        )
        ageing = billing_reports.ar_ageing()
        assert ageing["rows"] == []
        assert ageing["grand_total"] == Decimal("0.00")


class TestPatientStatement:
    def test_reconciles_after_a_full_scenario(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        _complete_visit(patient, doctor_profile, secretary)
        invoice = Invoice.objects.get(patient=patient)
        billing_services.record_payment(
            invoice=invoice, amount=Decimal("40.00"),
            payment_method=PaymentMethod.CASH, received_by=secretary,
        )
        billing_services.issue_credit_note(
            invoice=invoice, amount=Decimal("15.00"), reason_code="test", approved_by=manager,
        )

        statement = billing_reports.patient_statement(patient)
        assert statement["reconciles"] is True
        assert statement["ledger_balance"] == statement["invoice_derived_balance"]
        assert len(statement["invoices"]) == 1
        assert len(statement["payments"]) == 1
        assert len(statement["credit_notes"]) == 1

    def test_reconciles_with_no_activity(self, patient):
        statement = billing_reports.patient_statement(patient)
        assert statement["reconciles"] is True
        assert statement["ledger_balance"] == Decimal("0.00")


class TestTrialBalanceReExport:
    def test_accounting_reports_trial_balance_is_the_same_function(self):
        assert accounting_reports.trial_balance is accounting_services.trial_balance
