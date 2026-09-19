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

    def test_agrees_with_billing_report_with_a_discount(
        self, patient, doctor_profile, secretary,
    ):
        """`billing_report()["total_billed"]` sums `Invoice.total`, which is
        already net of discount (`total = subtotal - discount`); the ledger's
        income_statement reaches the same figure a different way (gross
        revenue lines minus the DISCOUNT contra line). Same concept, same
        number, two independent code paths — this is the roadmap's Task 9
        DoD item ("the existing billing_report() agrees with the new
        reports") for the one case where the two really do represent the
        same thing."""
        from apps.billing.models import Invoice as InvoiceModel
        from apps.billing.models import InvoiceItem

        from apps.core.enums import InvoiceStatus

        item = ServiceItem.objects.create(
            name="Consult", item_type=ServiceItemType.CONSULTATION, default_price=Decimal("100.00"),
        )
        invoice = InvoiceModel.objects.create(
            patient=patient, doctor=doctor_profile.user, status=InvoiceStatus.ISSUED,
        )
        InvoiceItem.objects.create(
            invoice=invoice, description=item.name, service_item=item,
            quantity=1, unit_price=item.default_price,
        )
        invoice.discount = Decimal("20.00")
        invoice.recalculate_totals()
        billing_services.post_invoice_issued(invoice, user=secretary)

        today = timezone.localdate()
        statement = accounting_reports.income_statement(today, today)
        report = billing_services.billing_report(period="day")
        assert statement["total_revenue"] == report["total_billed"] == Decimal("80.00")

    def test_diverges_from_billing_report_after_a_credit_note_by_design(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        """A credit note never edits `Invoice.total` (financial roadmap Task 7
        — corrections never rewrite the original historical totals), so
        `billing_report()["total_billed"]` stays at what was originally
        invoiced. The ledger's income_statement, by contrast, nets the credit
        note's revenue reversal straight out of the REVENUE_BY_SERVICE_CATEGORY
        balance. Once a correction exists, these two numbers are no longer the
        same concept — "what was originally billed" vs. "revenue actually
        recognised after corrections" — so they are expected to diverge, and
        this test documents that instead of asserting a fake equality."""
        _complete_visit(patient, doctor_profile, secretary)
        invoice = Invoice.objects.get(patient=patient)
        billing_services.issue_credit_note(
            invoice=invoice, amount=Decimal("30.00"), reason_code="test", approved_by=manager,
        )

        today = timezone.localdate()
        statement = accounting_reports.income_statement(today, today)
        report = billing_services.billing_report(period="day")

        assert report["total_billed"] == Decimal("100.00")  # unchanged historical total
        assert statement["total_revenue"] == Decimal("70.00")  # net of the credit note
        assert statement["total_revenue"] != report["total_billed"]

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

    def test_reconciles_flag_is_true_in_the_normal_case(
        self, consultation_item, patient, doctor_profile, secretary,
    ):
        _complete_visit(patient, doctor_profile, secretary)
        ageing = billing_reports.ar_ageing()
        assert ageing["reconciles"] is True
        assert ageing["rows"][0]["reconciles"] is True
        assert ageing["grand_total"] == ageing["ledger_grand_total"]

    def test_reconciles_flag_catches_a_forced_drift(
        self, consultation_item, patient, doctor_profile, secretary,
    ):
        """Proves the reconciliation check actually detects a mismatch rather
        than trivially always passing: force `Invoice.balance` out of step
        with the ledger (bypassing the normal save()/posting path entirely,
        the way a hypothetical bug elsewhere might) and confirm the report
        surfaces it instead of silently reporting a clean number."""
        _complete_visit(patient, doctor_profile, secretary)
        invoice = Invoice.objects.get(patient=patient)
        Invoice.objects.filter(pk=invoice.pk).update(balance=Decimal("999.00"))

        ageing = billing_reports.ar_ageing()
        row = ageing["rows"][0]
        assert row["total"] == Decimal("999.00")
        assert row["ledger_balance"] == Decimal("100.00")  # the ledger never moved
        assert row["reconciles"] is False
        assert ageing["reconciles"] is False


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
