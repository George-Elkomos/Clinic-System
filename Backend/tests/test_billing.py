"""Phase 12 — Billing tests.

Week 1: derived-field invariants (Invoice.balance, InvoiceItem.line_total),
totals recalculation, FeeValidity window logic.
Week 2: the appointment-completion billing hook (auto-invoice + free follow-up),
payment recording, object-level isolation, and the manager report.
"""
from datetime import timedelta
from decimal import Decimal

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.appointments import services as appointment_services
from apps.billing.models import FeeValidity, Invoice, InvoiceItem, Payment, ServiceItem
from apps.core.enums import (
    BillingSourceType,
    InvoiceStatus,
    PaymentMethod,
    RoleChoices,
    ServiceItemType,
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def consultation_item(db):
    return ServiceItem.objects.create(
        name="General Consultation",
        name_ar="كشف عام",
        item_type=ServiceItemType.CONSULTATION,
        default_price=Decimal("50.00"),
    )


@pytest.fixture
def invoice(patient, doctor_profile):
    return Invoice.objects.create(
        patient=patient,
        doctor=doctor_profile.user,
        due_date=timezone.localdate() + timedelta(days=7),
        status=InvoiceStatus.ISSUED,
    )


class TestServiceItem:
    def test_catalog_entry_defaults(self, consultation_item):
        assert consultation_item.is_active is True
        assert consultation_item.default_price == Decimal("50.00")
        assert consultation_item.item_type == ServiceItemType.CONSULTATION


class TestInvoice:
    def test_balance_auto_computed_on_save(self, invoice):
        invoice.total = Decimal("120.00")
        invoice.paid_amount = Decimal("45.00")
        invoice.save()
        invoice.refresh_from_db()
        assert invoice.balance == Decimal("75.00")

    def test_balance_recomputed_even_with_update_fields(self, invoice):
        invoice.total = Decimal("100.00")
        invoice.save()
        invoice.paid_amount = Decimal("100.00")
        invoice.save(update_fields=["paid_amount"])
        invoice.refresh_from_db()
        assert invoice.balance == Decimal("0.00")

    def test_number_format(self, invoice):
        assert invoice.number == f"INV-{invoice.pk:05d}"

    def test_recalculate_totals_from_items(self, invoice, consultation_item):
        InvoiceItem.objects.create(
            invoice=invoice,
            description="General Consultation",
            service_item=consultation_item,
            quantity=1,
            unit_price=consultation_item.default_price,
            source_type=BillingSourceType.APPOINTMENT,
        )
        InvoiceItem.objects.create(
            invoice=invoice,
            description="Blood panel",
            quantity=2,
            unit_price=Decimal("15.50"),
            source_type=BillingSourceType.LAB_ORDER,
        )
        invoice.discount = Decimal("10.00")
        invoice.recalculate_totals()
        invoice.refresh_from_db()
        assert invoice.subtotal == Decimal("81.00")   # 50 + 2*15.50
        assert invoice.total == Decimal("71.00")      # subtotal - discount
        assert invoice.balance == Decimal("71.00")    # nothing paid yet


class TestInvoiceItem:
    def test_line_total_auto_computed(self, invoice, consultation_item):
        item = InvoiceItem.objects.create(
            invoice=invoice,
            description="General Consultation",
            service_item=consultation_item,
            quantity=3,
            unit_price=Decimal("50.00"),
        )
        item.refresh_from_db()
        assert item.line_total == Decimal("150.00")

    def test_service_item_delete_sets_null_and_keeps_line(self, invoice, consultation_item):
        item = InvoiceItem.objects.create(
            invoice=invoice,
            description="General Consultation",
            service_item=consultation_item,
            quantity=1,
            unit_price=Decimal("50.00"),
        )
        consultation_item.delete()
        item.refresh_from_db()
        assert item.service_item is None
        assert item.line_total == Decimal("50.00")


class TestPayment:
    def test_payment_recorded_against_invoice(self, invoice, secretary):
        payment = Payment.objects.create(
            invoice=invoice,
            amount=Decimal("25.00"),
            payment_method=PaymentMethod.CASH,
            received_by=secretary,
        )
        assert payment.paid_at is not None
        assert invoice.payments.count() == 1


class TestFeeValidity:
    def _make(self, invoice, patient, doctor, **overrides):
        today = timezone.localdate()
        defaults = dict(
            patient=patient,
            doctor=doctor,
            invoice=invoice,
            valid_from=today,
            valid_until=today + timedelta(days=14),
        )
        defaults.update(overrides)
        return FeeValidity.objects.create(**defaults)

    def test_covers_inside_window_with_free_visits_left(self, invoice, patient, doctor_profile):
        fv = self._make(invoice, patient, doctor_profile.user)
        assert fv.covers(timezone.localdate()) is True
        assert fv.covers(timezone.localdate() + timedelta(days=14)) is True

    def test_does_not_cover_outside_window(self, invoice, patient, doctor_profile):
        fv = self._make(invoice, patient, doctor_profile.user)
        assert fv.covers(timezone.localdate() + timedelta(days=15)) is False
        assert fv.covers(timezone.localdate() - timedelta(days=1)) is False

    def test_does_not_cover_when_free_visits_exhausted(self, invoice, patient, doctor_profile):
        fv = self._make(invoice, patient, doctor_profile.user, used_count=1, max_free_visits=1)
        assert fv.covers(timezone.localdate()) is False


# --------------------------------------------------------------------------
# Week 2 — completion hook, payments API, isolation, reports
# --------------------------------------------------------------------------

@pytest.fixture
def manager(make_user):
    return make_user("mgr@test.dev", RoleChoices.MANAGER, first_name="Man", last_name="Ager")


def _complete_visit(patient_user, doctor_profile, secretary):
    """Walk a patient through check-in -> COMPLETED and return the appointment."""
    appointment = appointment_services.create_walk_in(
        patient=patient_user.patient_profile, doctor=doctor_profile, created_by=secretary
    )
    return appointment_services.complete_appointment(appointment)


class TestCompletionBillingHook:
    def test_completion_creates_issued_invoice_with_catalog_price(
        self, consultation_item, patient, doctor_profile, secretary
    ):
        appointment = _complete_visit(patient, doctor_profile, secretary)

        invoice = Invoice.objects.get(patient=patient)
        assert invoice.status == InvoiceStatus.ISSUED
        assert invoice.doctor == doctor_profile.user
        assert invoice.total == consultation_item.default_price  # 50.00 from catalog
        assert invoice.balance == consultation_item.default_price
        item = invoice.items.get()
        assert item.service_item == consultation_item
        assert item.source_type == BillingSourceType.APPOINTMENT
        assert item.source_id == appointment.id
        # A fresh free-follow-up window opens with the invoice.
        fv = FeeValidity.objects.get(patient=patient, doctor=doctor_profile.user)
        assert fv.invoice == invoice
        assert fv.valid_from == timezone.localdate()
        assert fv.valid_until == timezone.localdate() + timedelta(days=14)
        assert fv.used_count == 0

    def test_doctor_fee_overrides_catalog_price(
        self, consultation_item, patient, doctor_profile, secretary
    ):
        doctor_profile.consultation_fee = Decimal("80.00")
        doctor_profile.save(update_fields=["consultation_fee"])
        _complete_visit(patient, doctor_profile, secretary)
        invoice = Invoice.objects.get(patient=patient)
        assert invoice.total == Decimal("80.00")

    def test_catalog_bootstrapped_when_empty(self, patient, doctor_profile, secretary):
        assert ServiceItem.objects.count() == 0
        _complete_visit(patient, doctor_profile, secretary)
        item = ServiceItem.objects.get()
        assert item.item_type == ServiceItemType.CONSULTATION
        assert Invoice.objects.get(patient=patient).total == item.default_price

    def test_followup_inside_window_skips_invoice_and_increments_usage(
        self, consultation_item, patient, doctor_profile, secretary
    ):
        _complete_visit(patient, doctor_profile, secretary)   # visit 1 -> invoice + window
        _complete_visit(patient, doctor_profile, secretary)   # visit 2 -> free follow-up

        assert Invoice.objects.filter(patient=patient).count() == 1
        fv = FeeValidity.objects.get(patient=patient, doctor=doctor_profile.user)
        assert fv.used_count == 1

    def test_visit_after_free_quota_exhausted_creates_new_invoice(
        self, consultation_item, patient, doctor_profile, secretary
    ):
        _complete_visit(patient, doctor_profile, secretary)   # invoice 1, window opens
        _complete_visit(patient, doctor_profile, secretary)   # free (quota now used)
        _complete_visit(patient, doctor_profile, secretary)   # quota exhausted -> invoice 2

        assert Invoice.objects.filter(patient=patient).count() == 2
        assert FeeValidity.objects.filter(patient=patient).count() == 2

    def test_recompleting_same_appointment_does_not_double_bill(
        self, consultation_item, patient, doctor_profile, secretary
    ):
        appointment = _complete_visit(patient, doctor_profile, secretary)
        appointment_services.complete_appointment(appointment)  # idempotent re-complete
        assert Invoice.objects.filter(patient=patient).count() == 1
        assert FeeValidity.objects.get(patient=patient).used_count == 0


class TestInvoiceIsolation:
    def test_patient_cannot_read_another_patients_invoice(
        self, api, consultation_item, patient, patient2, doctor_profile, secretary
    ):
        _complete_visit(patient, doctor_profile, secretary)
        invoice = Invoice.objects.get(patient=patient)

        api.force_authenticate(patient2)
        assert api.get(reverse("invoice-detail", args=[invoice.id])).status_code == 404
        resp = api.get(reverse("invoice-list"))
        assert resp.status_code == 200
        assert resp.data["count"] == 0

    def test_patient_sees_own_invoices_and_staff_see_all(
        self, api, consultation_item, patient, doctor_profile, secretary
    ):
        _complete_visit(patient, doctor_profile, secretary)

        api.force_authenticate(patient)
        resp = api.get(reverse("invoice-list"))
        assert resp.data["count"] == 1
        assert resp.data["results"][0]["patient"] == patient.id

        api.force_authenticate(secretary)
        assert api.get(reverse("invoice-list")).data["count"] == 1


class TestPaymentAPI:
    @pytest.fixture
    def issued_invoice(self, consultation_item, patient, doctor_profile, secretary):
        _complete_visit(patient, doctor_profile, secretary)
        return Invoice.objects.get(patient=patient)  # total 50.00

    def test_partial_payment_sets_partially_paid(self, api, issued_invoice, secretary):
        api.force_authenticate(secretary)
        resp = api.post(reverse("payment-list"), {
            "invoice": issued_invoice.id, "amount": "20.00", "payment_method": "CASH",
        }, format="json")
        assert resp.status_code == 201
        issued_invoice.refresh_from_db()
        assert issued_invoice.status == InvoiceStatus.PARTIALLY_PAID
        assert issued_invoice.paid_amount == Decimal("20.00")
        assert issued_invoice.balance == Decimal("30.00")
        assert resp.data["invoice_detail"]["status"] == InvoiceStatus.PARTIALLY_PAID

    def test_full_payment_sets_paid(self, api, issued_invoice, secretary):
        api.force_authenticate(secretary)
        api.post(reverse("payment-list"), {
            "invoice": issued_invoice.id, "amount": "20.00", "payment_method": "CASH",
        }, format="json")
        resp = api.post(reverse("payment-list"), {
            "invoice": issued_invoice.id, "amount": "30.00", "payment_method": "CARD",
        }, format="json")
        assert resp.status_code == 201
        issued_invoice.refresh_from_db()
        assert issued_invoice.status == InvoiceStatus.PAID
        assert issued_invoice.balance == Decimal("0.00")
        assert issued_invoice.payments.count() == 2

    def test_overpayment_rejected(self, api, issued_invoice, secretary):
        api.force_authenticate(secretary)
        resp = api.post(reverse("payment-list"), {
            "invoice": issued_invoice.id, "amount": "999.00", "payment_method": "CASH",
        }, format="json")
        assert resp.status_code == 400
        issued_invoice.refresh_from_db()
        assert issued_invoice.status == InvoiceStatus.ISSUED

    def test_patient_cannot_record_payments(self, api, issued_invoice, patient):
        api.force_authenticate(patient)
        resp = api.post(reverse("payment-list"), {
            "invoice": issued_invoice.id, "amount": "50.00", "payment_method": "CASH",
        }, format="json")
        assert resp.status_code == 403


class TestBillingReport:
    def test_manager_gets_aggregates(
        self, api, consultation_item, patient, doctor_profile, secretary, manager
    ):
        _complete_visit(patient, doctor_profile, secretary)
        invoice = Invoice.objects.get(patient=patient)
        api.force_authenticate(secretary)
        api.post(reverse("payment-list"), {
            "invoice": invoice.id, "amount": "20.00", "payment_method": "CASH",
        }, format="json")

        api.force_authenticate(manager)
        resp = api.get(reverse("reports-billing"), {"period": "month"})
        assert resp.status_code == 200
        assert resp.data["total_billed"] == Decimal("50.00")
        assert resp.data["total_collected"] == Decimal("20.00")
        assert resp.data["total_outstanding"] == Decimal("30.00")
        (row,) = resp.data["revenue_by_doctor"]
        assert row["doctor_id"] == doctor_profile.user.id
        assert row["total_billed"] == Decimal("50.00")
        assert row["total_collected"] == Decimal("20.00")

    def test_non_managers_forbidden(self, api, patient, secretary):
        for user in (patient, secretary):
            api.force_authenticate(user)
            assert api.get(reverse("reports-billing")).status_code == 403


class TestInvoiceFilterPagination:
    """The billing desk's Outstanding tab needs status filtering to happen
    server-side. Default ordering is newest-first; an old unpaid invoice can
    sit behind many newer paid ones, so client-side filtering after fetching
    one page would silently drop it from view."""

    def test_status_in_filter_finds_old_unpaid_invoice_past_first_page(
        self, api, patient, doctor_profile, secretary
    ):
        old_unpaid = Invoice.objects.create(
            patient=patient, doctor=doctor_profile.user, status=InvoiceStatus.ISSUED,
            total=Decimal("50.00"),
        )
        for _ in range(25):  # newer, higher-id rows that outrank it in default ordering
            Invoice.objects.create(
                patient=patient, doctor=doctor_profile.user, status=InvoiceStatus.PAID,
                total=Decimal("50.00"), paid_amount=Decimal("50.00"),
            )

        api.force_authenticate(secretary)
        resp = api.get(reverse("invoice-list"), {"status": "ISSUED,PARTIALLY_PAID", "page_size": 20})
        assert resp.status_code == 200
        assert resp.data["count"] == 1
        assert resp.data["results"][0]["id"] == old_unpaid.id

    def test_page_size_and_page_params_respected(self, api, patient, doctor_profile, secretary):
        for _ in range(25):
            Invoice.objects.create(
                patient=patient, doctor=doctor_profile.user, status=InvoiceStatus.PAID,
                total=Decimal("50.00"), paid_amount=Decimal("50.00"),
            )
        api.force_authenticate(secretary)
        page1 = api.get(reverse("invoice-list"), {"status": "PAID", "page_size": 20, "page": 1})
        page2 = api.get(reverse("invoice-list"), {"status": "PAID", "page_size": 20, "page": 2})
        assert page1.data["count"] == 25
        assert len(page1.data["results"]) == 20
        assert len(page2.data["results"]) == 5
        assert {r["id"] for r in page1.data["results"]}.isdisjoint(
            {r["id"] for r in page2.data["results"]}
        )
