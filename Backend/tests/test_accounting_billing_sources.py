"""Financial roadmap Task 8 — the remaining billing sources (procedures,
radiology, lab orders). Each source reuses the exact Task 1 pattern
(InvoiceItem's UniqueConstraint(["source_type", "source_id"]) +
IntegrityError handler) via apps.billing.services.bill_ad_hoc_service — these
tests exercise that idempotency directly, plus each source's revenue mapping.

Medication/prescriptions are deliberately NOT billed: this clinic has no
in-house dispensing workflow, so billing at the point a prescription is
*written* would charge patients who fill it at an outside pharmacy. Billing
belongs at a real "dispensed from our own stock" event, which doesn't exist
yet — see docs/financial-design/MEDICATION_FINANCIAL_WORKFLOW_ANALYSIS.md.

The chart of accounts + an open Period covering "today" are seeded once for
the whole test session (see tests/conftest.py's django_db_setup override).
"""
from decimal import Decimal

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from django.utils import timezone

from apps.accounting.models import AccountMap, JournalEntry
from apps.billing import services as billing_services
from apps.billing.models import Invoice, InvoiceItem, ServiceItem
from apps.core.enums import BillingSourceType, LabOrderStatus, RoleChoices, ServiceItemType
from apps.medical_records.models import LabOrder, LabOrderItem
from apps.medical_records.services.lab_orders import complete_order as complete_lab_order
from apps.procedures.models import ClinicalProcedure, ProcedureTemplate
from apps.procedures.services import complete_procedure, start_procedure
from apps.radiology.models import RadiologyOrder
from apps.radiology.services import complete_order as complete_radiology_order

pytestmark = pytest.mark.django_db


@pytest.fixture
def secretary(make_user):
    return make_user("src-secretary@test.dev", RoleChoices.SECRETARY)


def _scan_file():
    return SimpleUploadedFile("scan.png", b"\x89PNG\r\n\x1a\n fake", content_type="image/png")


class TestProcedureBilling:
    def test_completed_procedure_bills_exactly_once(self, patient, doctor_profile):
        template = ProcedureTemplate.objects.create(name="Suturing")
        procedure = ClinicalProcedure.objects.create(
            patient=patient.patient_profile, doctor=doctor_profile, template=template,
        )
        procedure = start_procedure(procedure)
        complete_procedure(
            procedure, post_procedure_notes="Closed cleanly.", user=doctor_profile.user,
        )

        assert InvoiceItem.objects.filter(
            source_type=BillingSourceType.PROCEDURE, source_id=procedure.id,
        ).count() == 1
        invoice = Invoice.objects.get(patient=patient)

        # Directly re-invoking the billing hook (simulating a retried/duplicate
        # call, the Task 1 race scenario) must not double-bill.
        again = billing_services.handle_procedure_completed(procedure, user=doctor_profile.user)
        assert again.pk == invoice.pk
        assert InvoiceItem.objects.filter(
            source_type=BillingSourceType.PROCEDURE, source_id=procedure.id,
        ).count() == 1

    def test_procedure_revenue_posts_to_the_procedure_account(self, patient, doctor_profile):
        ServiceItem.objects.create(
            name="Suturing", item_type=ServiceItemType.PROCEDURE, default_price="120.00",
        )
        template = ProcedureTemplate.objects.create(name="Suturing")
        procedure = ClinicalProcedure.objects.create(
            patient=patient.patient_profile, doctor=doctor_profile, template=template,
        )
        procedure = start_procedure(procedure)
        complete_procedure(
            procedure, post_procedure_notes="Closed cleanly.", user=doctor_profile.user,
        )

        invoice = Invoice.objects.get(patient=patient)
        entry = JournalEntry.objects.get(idempotency_key=f"Invoice:{invoice.id}:issue")
        revenue_account = AccountMap.resolve("REVENUE_BY_SERVICE_CATEGORY", "PROCEDURE")
        assert entry.lines.get(account=revenue_account).credit == invoice.total == Decimal("120.00")


class TestRadiologyBilling:
    def test_completed_order_bills_exactly_once(self, patient, doctor_profile):
        order = RadiologyOrder.objects.create(
            patient=patient.patient_profile, doctor=doctor_profile, study_name="Chest X-Ray",
        )
        complete_radiology_order(order, file=_scan_file(), uploaded_by=doctor_profile.user)

        assert InvoiceItem.objects.filter(
            source_type=BillingSourceType.RADIOLOGY_ORDER, source_id=order.id,
        ).count() == 1
        invoice = Invoice.objects.get(patient=patient)

        again = billing_services.handle_radiology_order_completed(order, user=doctor_profile.user)
        assert again.pk == invoice.pk
        assert InvoiceItem.objects.filter(
            source_type=BillingSourceType.RADIOLOGY_ORDER, source_id=order.id,
        ).count() == 1

    def test_radiology_revenue_posts_to_the_radiology_account(self, patient, doctor_profile):
        ServiceItem.objects.create(
            name="X-Ray", item_type=ServiceItemType.RADIOLOGY, default_price="80.00",
        )
        order = RadiologyOrder.objects.create(
            patient=patient.patient_profile, doctor=doctor_profile, study_name="Chest X-Ray",
        )
        complete_radiology_order(order, file=_scan_file(), uploaded_by=doctor_profile.user)

        invoice = Invoice.objects.get(patient=patient)
        entry = JournalEntry.objects.get(idempotency_key=f"Invoice:{invoice.id}:issue")
        revenue_account = AccountMap.resolve("REVENUE_BY_SERVICE_CATEGORY", "RADIOLOGY")
        assert entry.lines.get(account=revenue_account).credit == invoice.total == Decimal("80.00")


class TestLabOrderBilling:
    def test_completed_order_bills_exactly_once(self, patient, doctor_profile, secretary):
        order = LabOrder.objects.create(
            patient=patient.patient_profile, doctor=doctor_profile, status=LabOrderStatus.PROCESSING,
        )
        LabOrderItem.objects.create(order=order, test_name="CBC")
        complete_lab_order(
            order,
            results_data=[{
                "test_name": "CBC", "result_value": "Normal", "result_date": timezone.localdate(),
            }],
            entered_by=secretary,
        )

        assert InvoiceItem.objects.filter(
            source_type=BillingSourceType.LAB_ORDER, source_id=order.id,
        ).count() == 1
        invoice = Invoice.objects.get(patient=patient)

        again = billing_services.handle_lab_order_completed(order, user=secretary)
        assert again.pk == invoice.pk
        assert InvoiceItem.objects.filter(
            source_type=BillingSourceType.LAB_ORDER, source_id=order.id,
        ).count() == 1

    def test_lab_order_revenue_posts_to_the_lab_test_account(self, patient, doctor_profile, secretary):
        ServiceItem.objects.create(
            name="CBC Panel", item_type=ServiceItemType.LAB_TEST, default_price="35.00",
        )
        order = LabOrder.objects.create(
            patient=patient.patient_profile, doctor=doctor_profile, status=LabOrderStatus.PROCESSING,
        )
        LabOrderItem.objects.create(order=order, test_name="CBC")
        complete_lab_order(
            order,
            results_data=[{
                "test_name": "CBC", "result_value": "Normal", "result_date": timezone.localdate(),
            }],
            entered_by=secretary,
        )

        invoice = Invoice.objects.get(patient=patient)
        entry = JournalEntry.objects.get(idempotency_key=f"Invoice:{invoice.id}:issue")
        revenue_account = AccountMap.resolve("REVENUE_BY_SERVICE_CATEGORY", "LAB_TEST")
        assert entry.lines.get(account=revenue_account).credit == invoice.total == Decimal("35.00")


class TestPrescriptionsAreNotBilled:
    def test_issuing_a_prescription_via_the_api_posts_nothing(self, api, patient, doctor_profile):
        """See the module docstring — no dispensing workflow exists, so
        writing a prescription must never create an invoice or ledger entry."""
        from apps.doctors.models import DoctorPatient

        DoctorPatient.objects.create(doctor=doctor_profile, patient=patient.patient_profile)
        api.force_authenticate(doctor_profile.user)
        payload = {
            "patient": patient.patient_profile.id,
            "items": [{"drug_name": "Amoxicillin", "dosage_strength": "500mg"}],
        }
        resp = api.post(reverse("prescription-list"), payload, format="json")
        assert resp.status_code == 201
        prescription_id = resp.data["id"]

        assert not InvoiceItem.objects.filter(
            source_type="PRESCRIPTION", source_id=prescription_id,
        ).exists()
        assert not Invoice.objects.filter(patient=patient).exists()


class TestZeroPriceCatalogBootstrap:
    def test_unconfigured_catalog_bills_at_zero_and_never_blocks_completion(
        self, patient, doctor_profile,
    ):
        """A procedure completes successfully even with no PROCEDURE catalog
        price configured — billing must never block clinical work."""
        template = ProcedureTemplate.objects.create(name="Suturing")
        procedure = ClinicalProcedure.objects.create(
            patient=patient.patient_profile, doctor=doctor_profile, template=template,
        )
        procedure = start_procedure(procedure)
        result = complete_procedure(
            procedure, post_procedure_notes="Closed cleanly.", user=doctor_profile.user,
        )
        assert result.status == "COMPLETED"

        invoice = Invoice.objects.get(patient=patient)
        assert invoice.total == Decimal("0.00")
        # A wholly free invoice posts nothing to the ledger — not an
        # imbalanced/invalid entry.
        assert not JournalEntry.objects.filter(
            idempotency_key=f"Invoice:{invoice.id}:issue",
        ).exists()
