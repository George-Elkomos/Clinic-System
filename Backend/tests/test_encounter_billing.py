"""Encounter-based DRAFT invoicing.

Clinical completion (procedure/radiology/lab order/appointment consultation)
captures an InvoiceItem onto its Encounter's accumulating DRAFT invoice — no
invoice_number, no invoice_date, no ledger posting yet. Reception checkout
(billing_services.issue_invoice, targeted by a specific Invoice.pk — never
"the Encounter's current DRAFT") allocates the gapless number, sets
invoice_date, transitions DRAFT -> ISSUED, and posts to the ledger exactly
once. A source with no Encounter keeps the original immediate
standalone-invoice fallback (bill_ad_hoc_service / handle_appointment_completed's
encounter-less branch) unchanged.

The chart of accounts + an open Period covering "today" are seeded once for
the whole test session (see tests/conftest.py's django_db_setup override).
"""
import threading
from datetime import timedelta
from decimal import Decimal

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import transaction as db_transaction
from django.urls import reverse
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.accounting import integrity
from apps.accounting.models import JournalEntry
from apps.appointments import services as appointment_services
from apps.billing import services as billing_services
from apps.billing.models import FeeValidity, Invoice, InvoiceItem, ServiceItem
from apps.billing.reports import ar_ageing, patient_statement
from apps.core.enums import (
    AppointmentStatus,
    BillingSourceType,
    InvoiceStatus,
    RoleChoices,
    ServiceItemType,
)
from apps.encounters.models import Encounter, EncounterStatus
from apps.medical_records.models import LabOrder, LabOrderItem
from apps.medical_records.services.lab_orders import complete_order as complete_lab_order
from apps.procedures.models import ClinicalProcedure, ProcedureTemplate
from apps.procedures.services import complete_procedure, start_procedure
from apps.radiology.models import RadiologyOrder
from apps.radiology.services import cancel_order as cancel_radiology_order
from apps.radiology.services import complete_order as complete_radiology_order

pytestmark = pytest.mark.django_db


@pytest.fixture
def secretary(make_user):
    return make_user("enc-bill-secretary@test.dev", RoleChoices.SECRETARY)


@pytest.fixture
def manager(make_user):
    return make_user("enc-bill-manager@test.dev", RoleChoices.MANAGER)


@pytest.fixture
def consultation_item(db):
    return ServiceItem.objects.create(
        name="General Consultation", name_ar="كشف عام",
        item_type=ServiceItemType.CONSULTATION, default_price=Decimal("50.00"),
    )


@pytest.fixture
def encounter(patient, doctor_profile):
    return Encounter.objects.create(
        patient=patient.patient_profile, doctor=doctor_profile, status=EncounterStatus.DRAFT,
    )


@pytest.fixture
def encounter2(patient, doctor_profile):
    return Encounter.objects.create(
        patient=patient.patient_profile, doctor=doctor_profile, status=EncounterStatus.DRAFT,
    )


def _scan_file():
    return SimpleUploadedFile("scan.png", b"\x89PNG\r\n\x1a\n fake", content_type="image/png")


def _complete_procedure(encounter_obj, patient_user, doctor_profile, name="Suturing"):
    template = ProcedureTemplate.objects.create(name=name)
    procedure = ClinicalProcedure.objects.create(
        patient=patient_user.patient_profile, doctor=doctor_profile, template=template,
        encounter=encounter_obj,
    )
    procedure = start_procedure(procedure)
    complete_procedure(procedure, post_procedure_notes="Closed cleanly.", user=doctor_profile.user)
    return procedure


def _complete_radiology_order(encounter_obj, patient_user, doctor_profile, study_name="Chest X-Ray"):
    order = RadiologyOrder.objects.create(
        patient=patient_user.patient_profile, doctor=doctor_profile,
        study_name=study_name, encounter=encounter_obj,
    )
    complete_radiology_order(order, file=_scan_file(), uploaded_by=doctor_profile.user)
    return order


def _complete_lab_order(encounter_obj, patient_user, doctor_profile, secretary_user):
    order = LabOrder.objects.create(
        patient=patient_user.patient_profile, doctor=doctor_profile,
        status="PROCESSING", encounter=encounter_obj,
    )
    LabOrderItem.objects.create(order=order, test_name="CBC")
    complete_lab_order(
        order,
        results_data=[{
            "test_name": "CBC", "result_value": "Normal", "result_date": timezone.localdate(),
        }],
        entered_by=secretary_user,
    )
    return order


def _complete_visit_with_encounter(patient_user, doctor_profile, secretary_user):
    """Walk-in appointment, linked to a fresh Encounter, completed — the
    consultation-charge equivalent of the procedure/radiology/lab helpers."""
    appointment = appointment_services.create_walk_in(
        patient=patient_user.patient_profile, doctor=doctor_profile, created_by=secretary_user,
    )
    encounter_obj = Encounter.objects.create(
        patient=patient_user.patient_profile, doctor=doctor_profile,
        appointment=appointment, status=EncounterStatus.DRAFT,
    )
    appointment_services.complete_appointment(appointment, user=secretary_user)
    return appointment, encounter_obj


class TestChargeCapture:
    def test_two_services_same_encounter_share_one_draft_invoice(
        self, encounter, patient, doctor_profile,
    ):
        _complete_procedure(encounter, patient, doctor_profile)
        _complete_radiology_order(encounter, patient, doctor_profile)

        invoices = Invoice.objects.filter(encounter=encounter)
        assert invoices.count() == 1
        invoice = invoices.get()
        assert invoice.status == InvoiceStatus.DRAFT
        assert invoice.items.count() == 2

    def test_two_encounters_same_patient_get_separate_drafts(
        self, encounter, encounter2, patient, doctor_profile,
    ):
        _complete_procedure(encounter, patient, doctor_profile, name="Suturing A")
        _complete_procedure(encounter2, patient, doctor_profile, name="Suturing B")

        invoice1 = Invoice.objects.get(encounter=encounter)
        invoice2 = Invoice.objects.get(encounter=encounter2)
        assert invoice1.pk != invoice2.pk

    def test_duplicate_completion_does_not_double_capture(self, encounter, patient, doctor_profile):
        procedure = _complete_procedure(encounter, patient, doctor_profile)
        invoice = Invoice.objects.get(encounter=encounter)

        again = billing_services.handle_procedure_completed(procedure, user=doctor_profile.user)
        assert again.pk == invoice.pk
        assert InvoiceItem.objects.filter(
            source_type=BillingSourceType.PROCEDURE, source_id=procedure.id,
        ).count() == 1

    def test_encounter_less_service_keeps_immediate_standalone_invoice(self, patient, doctor_profile):
        """Preserved fallback: no Encounter attached -> issued immediately,
        exactly as before this feature existed."""
        template = ProcedureTemplate.objects.create(name="Suturing")
        procedure = ClinicalProcedure.objects.create(
            patient=patient.patient_profile, doctor=doctor_profile, template=template,
        )
        procedure = start_procedure(procedure)
        complete_procedure(procedure, post_procedure_notes="Closed cleanly.", user=doctor_profile.user)

        invoice = Invoice.objects.get(patient=patient)
        assert invoice.status == InvoiceStatus.ISSUED
        assert invoice.invoice_number != ""
        assert invoice.invoice_date == timezone.localdate()

    def test_draft_invoice_has_no_number_date_or_ledger_posting(
        self, encounter, patient, doctor_profile,
    ):
        _complete_procedure(encounter, patient, doctor_profile)
        invoice = Invoice.objects.get(encounter=encounter)

        assert invoice.invoice_number == ""
        assert invoice.invoice_date is None
        assert not JournalEntry.objects.filter(source_type="Invoice", source_id=invoice.id).exists()

    def test_appointment_consultation_accumulates_when_encounter_linked(
        self, consultation_item, patient, doctor_profile, secretary,
    ):
        appointment, encounter_obj = _complete_visit_with_encounter(patient, doctor_profile, secretary)

        invoice = Invoice.objects.get(encounter=encounter_obj)
        assert invoice.status == InvoiceStatus.DRAFT
        assert invoice.items.filter(source_type=BillingSourceType.APPOINTMENT).exists()
        # FeeValidity still created at charge-capture time (see TestFeeValidityTiming).
        assert FeeValidity.objects.filter(invoice=invoice).exists()


@pytest.mark.django_db(transaction=True)
class TestConcurrentDraftCreation:
    def test_concurrent_capture_for_the_same_encounter_creates_one_draft(
        self, encounter, patient, doctor_profile,
    ):
        """Real threads, real PostgreSQL row locking (same pattern as
        test_invoice_numbering.py's concurrent-allocation test) — proves
        `uniq_draft_invoice_per_encounter` + get_or_create_draft_invoice's
        savepoint/retry actually serializes the race instead of merely
        looking safe in a single-threaded test."""
        from django.db import connection

        templates = [ProcedureTemplate.objects.create(name=f"Proc {i}") for i in range(5)]
        procedures = []
        for template in templates:
            procedure = ClinicalProcedure.objects.create(
                patient=patient.patient_profile, doctor=doctor_profile, template=template,
                encounter=encounter,
            )
            procedures.append(start_procedure(procedure))

        errors = []
        barrier = threading.Barrier(5)

        def _complete(procedure):
            try:
                barrier.wait(timeout=5)
                with db_transaction.atomic():
                    complete_procedure(
                        procedure, post_procedure_notes="Closed.", user=doctor_profile.user,
                    )
            except Exception as exc:  # pragma: no cover - failure path only
                errors.append(exc)
            finally:
                connection.close()

        threads = [threading.Thread(target=_complete, args=(p,)) for p in procedures]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert not errors
        invoices = Invoice.objects.filter(encounter=encounter, status=InvoiceStatus.DRAFT)
        assert invoices.count() == 1
        assert invoices.get().items.count() == 5


class TestCheckout:
    def test_issue_requires_at_least_one_item(self, encounter, patient, doctor_profile, secretary):
        invoice = billing_services.get_or_create_draft_invoice(
            encounter, patient=patient, doctor=doctor_profile.user,
        )
        with pytest.raises(ValidationError):
            billing_services.issue_invoice(invoice.pk, user=secretary)

    def test_issue_allocates_exactly_one_number_sets_date_and_posts_once(
        self, encounter, patient, doctor_profile, secretary,
    ):
        ServiceItem.objects.create(
            name="Suturing", item_type=ServiceItemType.PROCEDURE, default_price="120.00",
        )
        _complete_procedure(encounter, patient, doctor_profile)
        draft = Invoice.objects.get(encounter=encounter)

        issued = billing_services.issue_invoice(draft.pk, user=secretary)

        assert issued.pk == draft.pk
        assert issued.status == InvoiceStatus.ISSUED
        assert issued.invoice_number != ""
        assert issued.invoice_date == timezone.localdate()
        assert JournalEntry.objects.filter(
            source_type="Invoice", source_id=issued.id, idempotency_key=f"Invoice:{issued.id}:issue",
        ).count() == 1

    def test_replay_of_the_same_pk_is_safe(self, encounter, patient, doctor_profile, secretary):
        ServiceItem.objects.create(
            name="Suturing", item_type=ServiceItemType.PROCEDURE, default_price="120.00",
        )
        _complete_procedure(encounter, patient, doctor_profile)
        draft = Invoice.objects.get(encounter=encounter)

        first = billing_services.issue_invoice(draft.pk, user=secretary)
        second = billing_services.issue_invoice(draft.pk, user=secretary)

        assert first.pk == second.pk
        assert first.invoice_number == second.invoice_number
        assert JournalEntry.objects.filter(
            source_type="Invoice", source_id=first.id,
        ).count() == 1

    def test_cancelled_invoice_cannot_be_issued(self, encounter, patient, doctor_profile, secretary):
        _complete_procedure(encounter, patient, doctor_profile)
        draft = Invoice.objects.get(encounter=encounter)
        draft.status = InvoiceStatus.CANCELLED
        draft.save(update_fields=["status"])

        with pytest.raises(ValidationError):
            billing_services.issue_invoice(draft.pk, user=secretary)

    def test_needs_pricing_blocks_issuance(self, encounter, patient, doctor_profile, secretary):
        # Deliberately no ServiceItem seeded for PROCEDURE -> _catalog_price
        # bootstraps one at 0.00 and flags needs_pricing.
        _complete_procedure(encounter, patient, doctor_profile)
        draft = Invoice.objects.get(encounter=encounter)
        assert draft.items.get().needs_pricing is True

        with pytest.raises(ValidationError):
            billing_services.issue_invoice(draft.pk, user=secretary)

    def test_explicitly_configured_zero_price_does_not_block_issuance(
        self, encounter, patient, doctor_profile, secretary,
    ):
        ServiceItem.objects.create(
            name="Complimentary consult", item_type=ServiceItemType.PROCEDURE,
            default_price=Decimal("0.00"), is_active=True,
        )
        _complete_procedure(encounter, patient, doctor_profile)
        draft = Invoice.objects.get(encounter=encounter)
        item = draft.items.get()
        assert item.needs_pricing is False
        assert item.unit_price == Decimal("0.00")

        issued = billing_services.issue_invoice(draft.pk, user=secretary)
        assert issued.status == InvoiceStatus.ISSUED


class TestLateCharges:
    def test_late_charge_creates_supplementary_draft_original_untouched(
        self, encounter, patient, doctor_profile, secretary,
    ):
        ServiceItem.objects.create(
            name="Suturing", item_type=ServiceItemType.PROCEDURE, default_price="120.00",
        )
        _complete_procedure(encounter, patient, doctor_profile)
        invoice_a = billing_services.issue_invoice(
            Invoice.objects.get(encounter=encounter).pk, user=secretary,
        )
        snapshot = (
            invoice_a.pk, invoice_a.invoice_number, invoice_a.total,
            list(invoice_a.items.values_list("id", flat=True)),
            JournalEntry.objects.filter(source_type="Invoice", source_id=invoice_a.id).count(),
        )

        # Late-completing service for the same Encounter, after checkout.
        _complete_radiology_order(encounter, patient, doctor_profile)

        invoice_a.refresh_from_db()
        assert (
            invoice_a.pk, invoice_a.invoice_number, invoice_a.total,
            list(invoice_a.items.values_list("id", flat=True)),
            JournalEntry.objects.filter(source_type="Invoice", source_id=invoice_a.id).count(),
        ) == snapshot

        invoice_b = Invoice.objects.get(encounter=encounter, status=InvoiceStatus.DRAFT)
        assert invoice_b.pk != invoice_a.pk
        assert invoice_b.items.get().source_type == BillingSourceType.RADIOLOGY_ORDER

    def test_retry_of_old_pk_cannot_issue_the_supplementary_invoice(
        self, encounter, patient, doctor_profile, secretary,
    ):
        ServiceItem.objects.create(
            name="Suturing", item_type=ServiceItemType.PROCEDURE, default_price="120.00",
        )
        _complete_procedure(encounter, patient, doctor_profile)
        invoice_a = billing_services.issue_invoice(
            Invoice.objects.get(encounter=encounter).pk, user=secretary,
        )
        _complete_radiology_order(encounter, patient, doctor_profile)
        invoice_b = Invoice.objects.get(encounter=encounter, status=InvoiceStatus.DRAFT)

        # A delayed/retried request naming invoice_a's own pk can only ever
        # replay invoice_a — never resolve to invoice_b.
        replay = billing_services.issue_invoice(invoice_a.pk, user=secretary)
        assert replay.pk == invoice_a.pk
        invoice_b.refresh_from_db()
        assert invoice_b.status == InvoiceStatus.DRAFT  # untouched


class TestPriceResolution:
    def test_resolution_is_one_way(self, encounter, patient, doctor_profile, secretary):
        _complete_procedure(encounter, patient, doctor_profile)
        item = Invoice.objects.get(encounter=encounter).items.get()
        assert item.needs_pricing is True

        resolved = billing_services.resolve_item_pricing(
            item, unit_price=Decimal("75.00"), user=secretary,
        )
        assert resolved.needs_pricing is False
        assert resolved.unit_price == Decimal("75.00")
        assert resolved.price_resolved_by_id == secretary.id

        with pytest.raises(ValidationError):
            billing_services.resolve_item_pricing(resolved, unit_price=Decimal("999.00"), user=secretary)

    def test_issued_item_cannot_be_repriced(self, encounter, patient, doctor_profile, secretary):
        ServiceItem.objects.create(
            name="Suturing", item_type=ServiceItemType.PROCEDURE, default_price="120.00",
        )
        _complete_procedure(encounter, patient, doctor_profile)
        draft = Invoice.objects.get(encounter=encounter)
        item = draft.items.get()
        billing_services.issue_invoice(draft.pk, user=secretary)

        item.refresh_from_db()
        with pytest.raises(ValidationError):
            billing_services.resolve_item_pricing(item, unit_price=Decimal("50.00"), user=secretary)


class TestDraftVisibility:
    def test_draft_hidden_from_general_invoice_api_for_every_role(
        self, api, encounter, patient, doctor_profile, secretary, manager,
    ):
        _complete_procedure(encounter, patient, doctor_profile)
        draft = Invoice.objects.get(encounter=encounter)

        for user in (secretary, manager, patient, doctor_profile.user):
            api.force_authenticate(user)
            resp = api.get(reverse("invoice-detail", args=[draft.id]))
            assert resp.status_code == 404, user.role

            list_resp = api.get(reverse("invoice-list"))
            assert draft.id not in [row["id"] for row in list_resp.data["results"]], user.role

    def test_draft_excluded_from_patient_statement(self, encounter, patient, doctor_profile):
        _complete_procedure(encounter, patient, doctor_profile)
        statement = patient_statement(patient)
        assert statement["invoices"] == []

    def test_draft_excluded_from_ar_ageing(self, encounter, patient, doctor_profile):
        _complete_procedure(encounter, patient, doctor_profile)
        ageing = ar_ageing()
        assert all(row["patient_id"] != patient.id for row in ageing["rows"])


class TestRadiologyCancellation:
    def test_cancelling_a_completed_order_removes_the_draft_item(
        self, encounter, patient, doctor_profile,
    ):
        order = _complete_radiology_order(encounter, patient, doctor_profile)
        draft = Invoice.objects.get(encounter=encounter)
        assert draft.items.count() == 1

        cancel_radiology_order(order, "Patient declined", doctor_profile.user)

        assert not InvoiceItem.objects.filter(
            source_type=BillingSourceType.RADIOLOGY_ORDER, source_id=order.id,
        ).exists()

    def test_cancelling_the_last_item_deletes_the_now_empty_draft(
        self, encounter, patient, doctor_profile,
    ):
        order = _complete_radiology_order(encounter, patient, doctor_profile)
        draft_id = Invoice.objects.get(encounter=encounter).pk

        cancel_radiology_order(order, "Patient declined", doctor_profile.user)

        assert not Invoice.objects.filter(pk=draft_id).exists()

    def test_cancelling_an_already_issued_order_never_alters_financial_history(
        self, encounter, patient, doctor_profile, secretary,
    ):
        ServiceItem.objects.create(
            name="X-Ray", item_type=ServiceItemType.RADIOLOGY, default_price="80.00",
        )
        order = _complete_radiology_order(encounter, patient, doctor_profile)
        draft = Invoice.objects.get(encounter=encounter)
        issued = billing_services.issue_invoice(draft.pk, user=secretary)
        items_before = list(issued.items.values_list("id", flat=True))
        total_before = issued.total

        cancel_radiology_order(order, "Patient declined", doctor_profile.user)

        issued.refresh_from_db()
        assert issued.status == InvoiceStatus.ISSUED
        assert issued.total == total_before
        assert list(issued.items.values_list("id", flat=True)) == items_before
        assert InvoiceItem.objects.filter(
            source_type=BillingSourceType.RADIOLOGY_ORDER, source_id=order.id,
        ).exists()  # untouched, still there


class TestFeeValidityTiming:
    def test_feevalidity_still_created_at_charge_capture_not_checkout(
        self, consultation_item, patient, doctor_profile, secretary,
    ):
        appointment, encounter_obj = _complete_visit_with_encounter(patient, doctor_profile, secretary)
        draft = Invoice.objects.get(encounter=encounter_obj)

        # Created immediately — before any checkout has happened.
        fv = FeeValidity.objects.get(invoice=draft)
        assert fv.patient_id == patient.id
        assert fv.doctor_id == doctor_profile.user_id
        assert draft.status == InvoiceStatus.DRAFT  # not yet issued


class TestTask16Integration:
    def test_unresolved_needs_pricing_is_reported(self, encounter, patient, doctor_profile):
        _complete_procedure(encounter, patient, doctor_profile)
        item = Invoice.objects.get(encounter=encounter).items.get()

        result = integrity.run_revenue_integrity_check()
        hits = [f for f in result["findings"] if f["object_type"] == "InvoiceItem" and f["object_id"] == item.id]
        assert len(hits) == 1
        assert hits[0]["severity"] == "warning"
        assert hits[0]["category"] == "unresolved_needs_pricing"

    def test_clinical_completion_survives_a_billing_capture_failure(
        self, encounter, patient, doctor_profile, monkeypatch,
    ):
        """Same failure-isolation guarantee as the encounter-less path
        (bill_after_clinical_completion): a billing exception during
        encounter-linked capture must never undo the clinical completion."""
        template = ProcedureTemplate.objects.create(name="Suturing")
        procedure = ClinicalProcedure.objects.create(
            patient=patient.patient_profile, doctor=doctor_profile, template=template,
            encounter=encounter,
        )
        procedure = start_procedure(procedure)

        def _boom(*args, **kwargs):
            raise RuntimeError("simulated billing outage")

        monkeypatch.setattr(billing_services, "capture_encounter_charge", _boom)
        complete_procedure(procedure, post_procedure_notes="Closed cleanly.", user=doctor_profile.user)

        procedure.refresh_from_db()
        assert procedure.status == "COMPLETED"
        assert not InvoiceItem.objects.filter(
            source_type=BillingSourceType.PROCEDURE, source_id=procedure.id,
        ).exists()


class TestFreeFollowUpWithEncounter:
    """Final pre-commit regression check: the approved baseline deliberately
    excludes Appointment from Task 16's unbilled_clinical_completions check
    because a legitimate free follow-up correctly has no InvoiceItem. This
    proves the encounter-DRAFT refactor didn't change that — the free-visit
    early-return in handle_appointment_completed happens before any
    encounter/DRAFT-invoice logic runs at all, encounter present or not."""

    def test_free_followup_with_encounter_creates_no_billing_artifacts(
        self, consultation_item, patient, doctor_profile, secretary,
    ):
        # First visit: pays the catalog price, opens the follow-up window.
        appointment1, encounter1 = _complete_visit_with_encounter(patient, doctor_profile, secretary)
        fee_validity = FeeValidity.objects.get(patient=patient, doctor=doctor_profile.user)
        assert fee_validity.used_count == 0
        assert Invoice.objects.filter(encounter=encounter1).exists()  # sanity: first visit did bill

        invoices_before = Invoice.objects.count()
        items_before = InvoiceItem.objects.count()
        entries_before = JournalEntry.objects.count()

        # Second visit, within the free-follow-up window, also has its own
        # Encounter — this is exactly the combination the refactor touched.
        appointment2 = appointment_services.create_walk_in(
            patient=patient.patient_profile, doctor=doctor_profile, created_by=secretary,
        )
        encounter2 = Encounter.objects.create(
            patient=patient.patient_profile, doctor=doctor_profile,
            appointment=appointment2, status=EncounterStatus.DRAFT,
        )

        result = appointment_services.complete_appointment(appointment2, user=secretary)

        # Appointment completes successfully.
        assert result.status == AppointmentStatus.COMPLETED
        # Response truthfulness: never implies a paid invoice was created.
        assert result.billing_invoice is None
        assert result.billing_fee_validity is not None
        assert result.billing_fee_validity.pk == fee_validity.pk

        # No DRAFT invoice created solely because encounter2 exists.
        assert not Invoice.objects.filter(encounter=encounter2).exists()
        # No InvoiceItem, no invoice number allocated, no JournalEntry posted —
        # counts are byte-identical to before this completion.
        assert Invoice.objects.count() == invoices_before
        assert InvoiceItem.objects.count() == items_before
        assert JournalEntry.objects.count() == entries_before
        assert not InvoiceItem.objects.filter(
            source_type=BillingSourceType.APPOINTMENT, source_id=appointment2.id,
        ).exists()

        # Existing FeeValidity consumption semantics unchanged: incremented once.
        fee_validity.refresh_from_db()
        assert fee_validity.used_count == 1

        # The EncounterViewSet.submit response contract this feeds: never a
        # false "invoice ready"/"pending checkout" signal for a free visit.
        is_draft = result.billing_invoice is not None and result.billing_invoice.status == InvoiceStatus.DRAFT
        assert is_draft is False


class TestNewEndpointAuthorization:
    """Secretary/Manager only — Patient/Doctor must not be able to see,
    issue, or resolve pricing on internal DRAFT billing objects."""

    def test_pending_bill_forbidden_for_patient_and_doctor(
        self, api, encounter, patient, doctor_profile,
    ):
        for user in (patient, doctor_profile.user):
            api.force_authenticate(user)
            resp = api.get(reverse("encounter-pending-bill", args=[encounter.id]))
            assert resp.status_code == 403, user.role

    def test_pending_bill_allowed_for_secretary_and_manager(
        self, api, encounter, patient, doctor_profile, secretary, manager,
    ):
        _complete_procedure(encounter, patient, doctor_profile)
        for user in (secretary, manager):
            api.force_authenticate(user)
            resp = api.get(reverse("encounter-pending-bill", args=[encounter.id]))
            assert resp.status_code == 200, user.role
            assert resp.data["status"] == "DRAFT"

    def test_issue_forbidden_for_patient_and_doctor(self, api, encounter, patient, doctor_profile):
        ServiceItem.objects.create(
            name="Suturing", item_type=ServiceItemType.PROCEDURE, default_price="120.00",
        )
        _complete_procedure(encounter, patient, doctor_profile)
        draft = Invoice.objects.get(encounter=encounter)

        for user in (patient, doctor_profile.user):
            api.force_authenticate(user)
            resp = api.post(reverse("invoice-issue", args=[draft.id]))
            assert resp.status_code == 403, user.role

        draft.refresh_from_db()
        assert draft.status == InvoiceStatus.DRAFT  # never actually issued

    def test_resolve_pricing_forbidden_for_patient_and_doctor(
        self, api, encounter, patient, doctor_profile,
    ):
        _complete_procedure(encounter, patient, doctor_profile)
        item = Invoice.objects.get(encounter=encounter).items.get()

        for user in (patient, doctor_profile.user):
            api.force_authenticate(user)
            resp = api.post(
                reverse("invoice-item-resolve-pricing", args=[item.id]),
                {"unit_price": "50.00"}, format="json",
            )
            assert resp.status_code == 403, user.role

        item.refresh_from_db()
        assert item.needs_pricing is True  # never actually resolved


def _results(resp):
    return resp.data["results"] if isinstance(resp.data, dict) and "results" in resp.data else resp.data


class TestPendingCheckoutQueue:
    def test_secretary_allowed(self, api, encounter, patient, doctor_profile, secretary):
        _complete_procedure(encounter, patient, doctor_profile)
        api.force_authenticate(secretary)
        resp = api.get(reverse("invoice-pending-checkout"))
        assert resp.status_code == 200

    def test_manager_allowed(self, api, encounter, patient, doctor_profile, manager):
        _complete_procedure(encounter, patient, doctor_profile)
        api.force_authenticate(manager)
        resp = api.get(reverse("invoice-pending-checkout"))
        assert resp.status_code == 200

    def test_patient_forbidden(self, api, patient):
        api.force_authenticate(patient)
        resp = api.get(reverse("invoice-pending-checkout"))
        assert resp.status_code == 403

    def test_doctor_forbidden(self, api, doctor_profile):
        api.force_authenticate(doctor_profile.user)
        resp = api.get(reverse("invoice-pending-checkout"))
        assert resp.status_code == 403

    def test_only_pending_draft_encounter_invoices_returned(
        self, api, encounter, patient, doctor_profile, secretary,
    ):
        ServiceItem.objects.create(
            name="Suturing", item_type=ServiceItemType.PROCEDURE, default_price="120.00",
        )
        _complete_procedure(encounter, patient, doctor_profile)
        issued = billing_services.issue_invoice(
            Invoice.objects.get(encounter=encounter).pk, user=secretary,
        )

        pending_encounter = Encounter.objects.create(
            patient=patient.patient_profile, doctor=doctor_profile, status=EncounterStatus.DRAFT,
        )
        _complete_procedure(pending_encounter, patient, doctor_profile, name="Pending one")
        pending_invoice = Invoice.objects.get(encounter=pending_encounter)

        api.force_authenticate(secretary)
        resp = api.get(reverse("invoice-pending-checkout"))
        ids = [row["id"] for row in _results(resp)]

        assert pending_invoice.id in ids
        assert issued.id not in ids  # now ISSUED, must not appear

    def test_encounter_less_standalone_invoice_excluded(self, api, patient, doctor_profile, secretary):
        """An encounter-less charge is always issued immediately (unchanged
        fallback) — never appears as a pending checkout row."""
        template = ProcedureTemplate.objects.create(name="Standalone")
        procedure = ClinicalProcedure.objects.create(
            patient=patient.patient_profile, doctor=doctor_profile, template=template,
        )
        procedure = start_procedure(procedure)
        complete_procedure(procedure, post_procedure_notes="Done.", user=doctor_profile.user)
        standalone = Invoice.objects.get(patient=patient, encounter__isnull=True)

        api.force_authenticate(secretary)
        resp = api.get(reverse("invoice-pending-checkout"))
        ids = [row["id"] for row in _results(resp)]
        assert standalone.id not in ids

    def test_encounter_less_draft_row_excluded_defensively(
        self, api, patient, doctor_profile, secretary,
    ):
        """No current code path creates an encounter-less DRAFT invoice, but
        the queue's own encounter__isnull=False filter must exclude one if it
        ever existed, rather than assuming it can't."""
        Invoice.objects.create(patient=patient, doctor=doctor_profile.user, status=InvoiceStatus.DRAFT)
        api.force_authenticate(secretary)
        resp = api.get(reverse("invoice-pending-checkout"))
        assert _results(resp) == []

    def test_multiple_pending_encounters_ordered_oldest_first(
        self, api, patient, doctor_profile, secretary,
    ):
        enc_a = Encounter.objects.create(
            patient=patient.patient_profile, doctor=doctor_profile, status=EncounterStatus.DRAFT,
        )
        _complete_procedure(enc_a, patient, doctor_profile, name="A")
        invoice_a = Invoice.objects.get(encounter=enc_a)
        Invoice.objects.filter(pk=invoice_a.pk).update(created_at=timezone.now() - timedelta(hours=2))

        enc_b = Encounter.objects.create(
            patient=patient.patient_profile, doctor=doctor_profile, status=EncounterStatus.DRAFT,
        )
        _complete_procedure(enc_b, patient, doctor_profile, name="B")
        invoice_b = Invoice.objects.get(encounter=enc_b)

        api.force_authenticate(secretary)
        resp = api.get(reverse("invoice-pending-checkout"))
        ids = [row["id"] for row in _results(resp)]
        assert ids.index(invoice_a.id) < ids.index(invoice_b.id)

    def test_needs_pricing_state_represented(
        self, api, encounter, patient, doctor_profile, secretary,
    ):
        _complete_procedure(encounter, patient, doctor_profile)  # no ServiceItem seeded
        api.force_authenticate(secretary)
        resp = api.get(reverse("invoice-pending-checkout"))
        row = next(r for r in _results(resp) if r["encounter"] == encounter.id)
        assert row["item_count"] == 1
        assert row["needs_pricing_count"] == 1
        assert row["has_needs_pricing"] is True

    def test_empty_queue_returns_normal_empty_result(self, api, secretary):
        api.force_authenticate(secretary)
        resp = api.get(reverse("invoice-pending-checkout"))
        assert resp.status_code == 200
        assert _results(resp) == []

    def test_no_fake_invoice_number_exposed(
        self, api, encounter, patient, doctor_profile, secretary,
    ):
        _complete_procedure(encounter, patient, doctor_profile)
        api.force_authenticate(secretary)
        resp = api.get(reverse("invoice-pending-checkout"))
        row = _results(resp)[0]
        assert "number" not in row
        assert "invoice_number" not in row


class TestPendingBillSerializerFix:
    def test_pending_bill_has_no_fake_invoice_number(
        self, api, encounter, patient, doctor_profile, secretary,
    ):
        _complete_procedure(encounter, patient, doctor_profile)
        api.force_authenticate(secretary)
        resp = api.get(reverse("encounter-pending-bill", args=[encounter.id]))
        assert resp.status_code == 200
        assert "number" not in resp.data
        assert "invoice_number" not in resp.data
        assert resp.data["status"] == "DRAFT"

    def test_pending_bill_null_when_nothing_pending(
        self, api, encounter, secretary,
    ):
        api.force_authenticate(secretary)
        resp = api.get(reverse("encounter-pending-bill", args=[encounter.id]))
        assert resp.status_code == 200
        assert resp.data is None

    def test_normal_issued_invoice_detail_still_exposes_a_real_number(
        self, api, encounter, patient, doctor_profile, secretary,
    ):
        """Regression guard: the fix must not change InvoiceSerializer's own
        contract for a real, ISSUED invoice."""
        ServiceItem.objects.create(
            name="Suturing", item_type=ServiceItemType.PROCEDURE, default_price="120.00",
        )
        _complete_procedure(encounter, patient, doctor_profile)
        issued = billing_services.issue_invoice(
            Invoice.objects.get(encounter=encounter).pk, user=secretary,
        )
        api.force_authenticate(secretary)
        resp = api.get(reverse("invoice-detail", args=[issued.id]))
        assert resp.status_code == 200
        assert resp.data["number"] == issued.invoice_number
        assert resp.data["number"] != ""


class TestDoctorQueueContract:
    def test_draft_backed_appointment_has_no_viewable_invoice_id(
        self, api, consultation_item, patient, doctor_profile, secretary,
    ):
        appointment, encounter_obj = _complete_visit_with_encounter(patient, doctor_profile, secretary)
        invoice = Invoice.objects.get(encounter=encounter_obj)
        assert invoice.status == InvoiceStatus.DRAFT

        api.force_authenticate(doctor_profile.user)
        resp = api.get(reverse("appointment-my-queue"))
        assert resp.status_code == 200
        previous = resp.data["previous"]
        assert previous is not None
        assert previous["id"] == appointment.id
        assert previous["invoice_id"] is None
        assert previous["pending_checkout"] is True

    def test_after_issuance_the_real_invoice_id_becomes_available(
        self, api, consultation_item, patient, doctor_profile, secretary,
    ):
        appointment, encounter_obj = _complete_visit_with_encounter(patient, doctor_profile, secretary)
        draft = Invoice.objects.get(encounter=encounter_obj)
        issued = billing_services.issue_invoice(draft.pk, user=secretary)

        api.force_authenticate(doctor_profile.user)
        resp = api.get(reverse("appointment-my-queue"))
        previous = resp.data["previous"]
        assert previous["invoice_id"] == issued.id
        assert previous["pending_checkout"] is False

    def test_free_followup_does_not_pretend_checkout_or_invoice_exists(
        self, api, consultation_item, patient, doctor_profile, secretary,
    ):
        # First visit opens the follow-up window (encounter-less, for simplicity).
        appointment1 = appointment_services.create_walk_in(
            patient=patient.patient_profile, doctor=doctor_profile, created_by=secretary,
        )
        appointment_services.complete_appointment(appointment1, user=secretary)

        # Second visit, same day, consumes the free follow-up.
        appointment2 = appointment_services.create_walk_in(
            patient=patient.patient_profile, doctor=doctor_profile, created_by=secretary,
        )
        Encounter.objects.create(
            patient=patient.patient_profile, doctor=doctor_profile,
            appointment=appointment2, status=EncounterStatus.DRAFT,
        )
        appointment_services.complete_appointment(appointment2, user=secretary)

        api.force_authenticate(doctor_profile.user)
        resp = api.get(reverse("appointment-my-queue"))
        previous = resp.data["previous"]
        assert previous["id"] == appointment2.id
        assert previous["invoice_id"] is None
        assert previous["pending_checkout"] is False
