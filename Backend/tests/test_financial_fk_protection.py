"""Financial FK hardening: an invoice's financial detail rows must never be
silently cascade-deleted with it. `Invoice` itself is never hard-deleted in
this system (cancellation is a status change + a reversing ledger entry, see
services.cancel_invoice) — these tests prove that even a direct, out-of-band
`Invoice.delete()` (e.g. from a Django shell or the admin) is refused rather
than quietly taking `InvoiceItem`/`FeeValidity` rows down with it.
"""
from decimal import Decimal

import pytest
from django.db.models import ProtectedError

from apps.appointments import services as appointment_services
from apps.billing.models import FeeValidity, Invoice, InvoiceItem, ServiceItem
from apps.core.enums import RoleChoices, ServiceItemType

pytestmark = pytest.mark.django_db


@pytest.fixture
def consultation_item():
    return ServiceItem.objects.create(
        name="General Consultation", item_type=ServiceItemType.CONSULTATION,
        default_price=Decimal("100.00"),
    )


@pytest.fixture
def secretary(make_user):
    return make_user("fk-secretary@test.dev", RoleChoices.SECRETARY)


def _issued_invoice(consultation_item, patient, doctor_profile, secretary):
    appointment = appointment_services.create_walk_in(
        patient=patient.patient_profile, doctor=doctor_profile, created_by=secretary,
    )
    appointment_services.complete_appointment(appointment, user=secretary)
    return Invoice.objects.get(patient=patient)


class TestInvoiceItemProtection:
    def test_deleting_an_invoice_with_items_is_refused(
        self, consultation_item, patient, doctor_profile, secretary,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        assert invoice.items.exists()
        with pytest.raises(ProtectedError):
            invoice.delete()
        assert Invoice.objects.filter(pk=invoice.pk).exists()
        assert InvoiceItem.objects.filter(invoice=invoice).exists()


class TestFeeValidityProtection:
    def test_deleting_an_invoice_with_a_fee_validity_is_refused(
        self, consultation_item, patient, doctor_profile, secretary,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        assert FeeValidity.objects.filter(invoice=invoice).exists()
        with pytest.raises(ProtectedError):
            invoice.delete()
        assert FeeValidity.objects.filter(invoice=invoice).exists()

    def test_deleting_a_patient_with_a_fee_validity_is_refused(
        self, consultation_item, patient, doctor_profile, secretary,
    ):
        _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        assert FeeValidity.objects.filter(patient=patient).exists()
        with pytest.raises(ProtectedError):
            patient.delete()
