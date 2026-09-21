"""Financial roadmap Tasks 7/11/15 — the REST API surface for credit notes,
refunds, invoice cancellation, and cashier shifts, plus the permission rules
that gate them.

Every endpoint here is a thin wrapper around an already-tested service
function (see test_accounting_credit_refund_cancel.py / test_cashier_shifts.py
for the underlying business-rule coverage); these tests focus on what the API
layer itself is responsible for: auth, role gating, input shape, and that
`approved_by`/`cancelled_by` is always the authenticated caller, never a
client-supplied id.

Every write call passes a fresh `Idempotency-Key` (see `_idem()` below) —
credit-note/refund/payment now require one; cancel/open/close don't (they
were audited as already safe, see test_financial_idempotency.py), but passing
one anyway is harmless and keeps every call in this file uniform.
"""
import uuid
from decimal import Decimal

import pytest
from django.test import override_settings
from django.urls import reverse

from apps.accounting import services as accounting_services
from apps.appointments import services as appointment_services
from apps.billing.models import CashierShift, CreditNote, Invoice, Refund, ServiceItem, WriteOff
from apps.core.enums import CashierShiftStatus, InvoiceStatus, RoleChoices, ServiceItemType

pytestmark = pytest.mark.django_db


def _idem():
    return {"Idempotency-Key": str(uuid.uuid4())}


@pytest.fixture
def consultation_item():
    return ServiceItem.objects.create(
        name="General Consultation", item_type=ServiceItemType.CONSULTATION,
        default_price=Decimal("100.00"),
    )


@pytest.fixture
def manager(make_user):
    return make_user("api-manager@test.dev", RoleChoices.MANAGER)


@pytest.fixture
def other_secretary(make_user):
    return make_user("api-secretary2@test.dev", RoleChoices.SECRETARY)


def _issued_invoice(consultation_item, patient, doctor_profile, secretary):
    appointment = appointment_services.create_walk_in(
        patient=patient.patient_profile, doctor=doctor_profile, created_by=secretary,
    )
    appointment_services.complete_appointment(appointment, user=secretary)
    return Invoice.objects.get(patient=patient)  # total 100.00


class TestCreditNoteAPI:
    def test_manager_can_issue_a_credit_note(
        self, api, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        api.force_authenticate(manager)
        resp = api.post(
            reverse("invoice-credit-note", args=[invoice.id]),
            {"amount": "30.00", "reason_code": "goodwill_adjustment"},
            format="json", headers=_idem(),
        )
        assert resp.status_code == 201
        assert resp.data["amount"] == "30.00"
        assert resp.data["approved_by"] == manager.id
        assert resp.data["invoice"]["credited_amount"] == "30.00"
        note = CreditNote.objects.get(invoice=invoice)
        assert note.approved_by == manager

    def test_secretary_cannot_issue_a_credit_note(
        self, api, consultation_item, patient, doctor_profile, secretary,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        api.force_authenticate(secretary)
        resp = api.post(
            reverse("invoice-credit-note", args=[invoice.id]),
            {"amount": "10.00", "reason_code": "x"}, format="json", headers=_idem(),
        )
        assert resp.status_code == 403

    def test_anonymous_is_rejected(self, api, consultation_item, patient, doctor_profile, secretary):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        resp = api.post(
            reverse("invoice-credit-note", args=[invoice.id]),
            {"amount": "10.00", "reason_code": "x"}, format="json", headers=_idem(),
        )
        assert resp.status_code == 401

    def test_approved_by_is_never_taken_from_the_request_body(
        self, api, consultation_item, patient, doctor_profile, secretary, manager, other_secretary,
    ):
        """Even if a client tries to smuggle a different approver id in, the
        service is always called with request.user — there is no field on
        the serializer that could carry it through."""
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        api.force_authenticate(manager)
        resp = api.post(
            reverse("invoice-credit-note", args=[invoice.id]),
            {"amount": "10.00", "reason_code": "x", "approved_by": other_secretary.id},
            format="json", headers=_idem(),
        )
        assert resp.status_code == 201
        assert CreditNote.objects.get(invoice=invoice).approved_by == manager

    def test_amount_exceeding_the_invoice_returns_400_not_500(
        self, api, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        api.force_authenticate(manager)
        resp = api.post(
            reverse("invoice-credit-note", args=[invoice.id]),
            {"amount": "9999.00", "reason_code": "x"}, format="json", headers=_idem(),
        )
        assert resp.status_code == 400

    def test_missing_idempotency_key_is_400(
        self, api, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        api.force_authenticate(manager)
        resp = api.post(
            reverse("invoice-credit-note", args=[invoice.id]),
            {"amount": "10.00", "reason_code": "x"}, format="json",
        )
        assert resp.status_code == 400
        assert not CreditNote.objects.filter(invoice=invoice).exists()


class TestRefundAPI:
    def test_manager_can_issue_a_refund_and_it_is_capped_correctly(
        self, api, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        api.force_authenticate(secretary)
        api.post(reverse("payment-list"), {
            "invoice": invoice.id, "amount": "100.00", "payment_method": "CASH",
        }, format="json", headers=_idem())

        api.force_authenticate(manager)
        resp = api.post(
            reverse("invoice-refund", args=[invoice.id]),
            {"amount": "40.00", "payment_method": "CASH", "reason_code": "patient_left"},
            format="json", headers=_idem(),
        )
        assert resp.status_code == 201
        assert Refund.objects.get(invoice=invoice).approved_by == manager

        # Refusing to exceed what was actually collected, not invoice.total.
        resp2 = api.post(
            reverse("invoice-refund", args=[invoice.id]),
            {"amount": "70.00", "payment_method": "CASH", "reason_code": "patient_left"},
            format="json", headers=_idem(),
        )
        assert resp2.status_code == 400

    def test_paid_by_defaults_to_the_caller_but_can_name_a_different_cashier(
        self, api, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        api.force_authenticate(secretary)
        api.post(reverse("payment-list"), {
            "invoice": invoice.id, "amount": "100.00", "payment_method": "CASH",
        }, format="json", headers=_idem())

        api.force_authenticate(manager)
        resp = api.post(
            reverse("invoice-refund", args=[invoice.id]),
            {
                "amount": "20.00", "payment_method": "CASH", "reason_code": "overcharge",
                "paid_by": secretary.id,
            },
            format="json", headers=_idem(),
        )
        assert resp.status_code == 201
        refund = Refund.objects.get(invoice=invoice)
        assert refund.approved_by == manager  # approver stays the caller

    def test_patient_cannot_issue_a_refund(
        self, api, consultation_item, patient, doctor_profile, secretary,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        api.force_authenticate(patient)
        resp = api.post(
            reverse("invoice-refund", args=[invoice.id]),
            {"amount": "10.00", "payment_method": "CASH", "reason_code": "x"},
            format="json", headers=_idem(),
        )
        assert resp.status_code == 403

    def test_missing_idempotency_key_is_400(
        self, api, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        api.force_authenticate(secretary)
        api.post(reverse("payment-list"), {
            "invoice": invoice.id, "amount": "100.00", "payment_method": "CASH",
        }, format="json", headers=_idem())

        api.force_authenticate(manager)
        resp = api.post(
            reverse("invoice-refund", args=[invoice.id]),
            {"amount": "10.00", "payment_method": "CASH", "reason_code": "x"}, format="json",
        )
        assert resp.status_code == 400
        assert not Refund.objects.filter(invoice=invoice).exists()


class TestCancelInvoiceAPI:
    def test_manager_can_cancel_an_unpaid_invoice(
        self, api, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        api.force_authenticate(manager)
        resp = api.post(
            reverse("invoice-cancel", args=[invoice.id]),
            {"reason_code": "raised_by_mistake"}, format="json", headers=_idem(),
        )
        assert resp.status_code == 200
        assert resp.data["status"] == InvoiceStatus.CANCELLED
        invoice.refresh_from_db()
        assert invoice.status == InvoiceStatus.CANCELLED

    def test_cancelling_a_paid_invoice_is_refused_not_a_500(
        self, api, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        api.force_authenticate(secretary)
        api.post(reverse("payment-list"), {
            "invoice": invoice.id, "amount": "100.00", "payment_method": "CASH",
        }, format="json", headers=_idem())

        api.force_authenticate(manager)
        resp = api.post(
            reverse("invoice-cancel", args=[invoice.id]),
            {"reason_code": "raised_by_mistake"}, format="json", headers=_idem(),
        )
        assert resp.status_code == 400

    def test_reason_code_is_required(
        self, api, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        api.force_authenticate(manager)
        resp = api.post(
            reverse("invoice-cancel", args=[invoice.id]), {}, format="json", headers=_idem(),
        )
        assert resp.status_code == 400

    def test_secretary_cannot_cancel(
        self, api, consultation_item, patient, doctor_profile, secretary,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        api.force_authenticate(secretary)
        resp = api.post(
            reverse("invoice-cancel", args=[invoice.id]),
            {"reason_code": "x"}, format="json", headers=_idem(),
        )
        assert resp.status_code == 403

    def test_secretary_cannot_cancel_via_direct_service_call_either(
        self, consultation_item, patient, doctor_profile, secretary,
    ):
        """Financial roadmap Task 15: the DRF view's IsManager gate is not
        the only thing standing between a SECRETARY and a cancellation — the
        service itself refuses, so a shell/admin/background call is bound by
        the same rule."""
        from apps.billing import services
        from apps.billing.exceptions import ApprovalThresholdExceededError

        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        with pytest.raises(ApprovalThresholdExceededError):
            services.cancel_invoice(
                invoice=invoice, reason_code="x", cancelled_by=secretary,
            )


class TestWriteOffAPI:
    def test_manager_can_write_off_part_of_an_invoice(
        self, api, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        api.force_authenticate(manager)
        resp = api.post(
            reverse("invoice-write-off", args=[invoice.id]),
            {"amount": "30.00", "reason_code": "uncollectable"},
            format="json", headers=_idem(),
        )
        assert resp.status_code == 201
        assert resp.data["amount"] == "30.00"
        assert resp.data["approved_by"] == manager.id
        assert resp.data["approved_by_role"] == RoleChoices.MANAGER
        assert resp.data["invoice"]["written_off_amount"] == "30.00"

    def test_secretary_is_rejected_at_the_default_zero_threshold(
        self, api, consultation_item, patient, doctor_profile, secretary,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        api.force_authenticate(secretary)
        resp = api.post(
            reverse("invoice-write-off", args=[invoice.id]),
            {"amount": "10.00", "reason_code": "x"}, format="json", headers=_idem(),
        )
        assert resp.status_code == 403

    @override_settings(FINANCE_APPROVAL_THRESHOLD_WRITE_OFF="20.00")
    def test_secretary_within_a_raised_threshold_succeeds(
        self, api, consultation_item, patient, doctor_profile, secretary,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        api.force_authenticate(secretary)
        resp = api.post(
            reverse("invoice-write-off", args=[invoice.id]),
            {"amount": "20.00", "reason_code": "small"}, format="json", headers=_idem(),
        )
        assert resp.status_code == 201
        assert resp.data["approved_by_role"] == RoleChoices.SECRETARY

    def test_patient_cannot_write_off(
        self, api, consultation_item, patient, doctor_profile, secretary,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        api.force_authenticate(patient)
        resp = api.post(
            reverse("invoice-write-off", args=[invoice.id]),
            {"amount": "10.00", "reason_code": "x"}, format="json", headers=_idem(),
        )
        assert resp.status_code == 403

    def test_amount_exceeding_the_balance_returns_400_not_500(
        self, api, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        api.force_authenticate(manager)
        resp = api.post(
            reverse("invoice-write-off", args=[invoice.id]),
            {"amount": "9999.00", "reason_code": "x"}, format="json", headers=_idem(),
        )
        assert resp.status_code == 400

    def test_missing_idempotency_key_is_400(
        self, api, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        api.force_authenticate(manager)
        resp = api.post(
            reverse("invoice-write-off", args=[invoice.id]),
            {"amount": "10.00", "reason_code": "x"}, format="json",
        )
        assert resp.status_code == 400
        assert not WriteOff.objects.filter(invoice=invoice).exists()

    def test_approved_by_is_never_taken_from_the_request_body(
        self, api, consultation_item, patient, doctor_profile, secretary, manager, other_secretary,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        api.force_authenticate(manager)
        resp = api.post(
            reverse("invoice-write-off", args=[invoice.id]),
            {"amount": "10.00", "reason_code": "x", "approved_by": other_secretary.id},
            format="json", headers=_idem(),
        )
        assert resp.status_code == 201
        assert WriteOff.objects.get(invoice=invoice).approved_by == manager

    def test_manager_can_reverse_a_write_off(
        self, api, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        api.force_authenticate(manager)
        create_resp = api.post(
            reverse("invoice-write-off", args=[invoice.id]),
            {"amount": "30.00", "reason_code": "uncollectable"},
            format="json", headers=_idem(),
        )
        write_off_id = create_resp.data["id"]

        resp = api.post(
            reverse("write-off-reverse", args=[write_off_id]),
            {"reason_code": "reconsidered"}, format="json", headers=_idem(),
        )
        assert resp.status_code == 201
        assert resp.data["reversed_by"] == manager.id
        assert resp.data["reversed_by_role"] == RoleChoices.MANAGER
        assert resp.data["invoice"]["written_off_amount"] == "0.00"

    def test_secretary_cannot_reverse_a_write_off(
        self, api, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        api.force_authenticate(manager)
        create_resp = api.post(
            reverse("invoice-write-off", args=[invoice.id]),
            {"amount": "10.00", "reason_code": "x"}, format="json", headers=_idem(),
        )
        write_off_id = create_resp.data["id"]

        api.force_authenticate(secretary)
        resp = api.post(
            reverse("write-off-reverse", args=[write_off_id]),
            {"reason_code": "try_reverse"}, format="json", headers=_idem(),
        )
        assert resp.status_code == 403

    def test_a_write_off_cannot_be_reversed_twice_via_the_api(
        self, api, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        api.force_authenticate(manager)
        create_resp = api.post(
            reverse("invoice-write-off", args=[invoice.id]),
            {"amount": "10.00", "reason_code": "x"}, format="json", headers=_idem(),
        )
        write_off_id = create_resp.data["id"]
        api.post(
            reverse("write-off-reverse", args=[write_off_id]),
            {"reason_code": "first"}, format="json", headers=_idem(),
        )
        resp = api.post(
            reverse("write-off-reverse", args=[write_off_id]),
            {"reason_code": "second"}, format="json", headers=_idem(),
        )
        assert resp.status_code == 400


class TestCashierShiftAPI:
    def test_a_secretary_can_open_and_read_their_own_shift(self, api, secretary):
        api.force_authenticate(secretary)
        resp = api.post(reverse("cashier-shift-open"), {
            "till_id": "T1", "opening_float": "200.00",
        }, format="json", headers=_idem())
        assert resp.status_code == 201
        assert resp.data["cashier"] == secretary.id
        assert resp.data["status"] == CashierShiftStatus.OPEN

        current = api.get(reverse("cashier-shift-current"))
        assert current.status_code == 200
        assert current.data["id"] == resp.data["id"]

    def test_cashier_field_cannot_be_smuggled_in(self, api, secretary, manager):
        """Opening a shift always opens it for request.user — there's no way
        to open "as" someone else."""
        api.force_authenticate(secretary)
        resp = api.post(reverse("cashier-shift-open"), {
            "till_id": "T-smuggle", "cashier": manager.id,
        }, format="json", headers=_idem())
        assert resp.status_code == 201
        assert resp.data["cashier"] == secretary.id

    def test_a_secretary_cannot_see_another_cashiers_shift(
        self, api, secretary, other_secretary,
    ):
        api.force_authenticate(secretary)
        opened = api.post(
            reverse("cashier-shift-open"), {"till_id": "T2"}, format="json", headers=_idem(),
        )

        api.force_authenticate(other_secretary)
        resp = api.get(reverse("cashier-shift-detail", args=[opened.data["id"]]))
        assert resp.status_code == 404

    def test_manager_can_see_every_shift(self, api, secretary, manager):
        api.force_authenticate(secretary)
        opened = api.post(
            reverse("cashier-shift-open"), {"till_id": "T3"}, format="json", headers=_idem(),
        )

        api.force_authenticate(manager)
        resp = api.get(reverse("cashier-shift-detail", args=[opened.data["id"]]))
        assert resp.status_code == 200

    def test_an_exact_count_can_be_closed_by_the_cashier_alone(self, api, secretary):
        api.force_authenticate(secretary)
        opened = api.post(reverse("cashier-shift-open"), {
            "till_id": "T4", "opening_float": "100.00",
        }, format="json", headers=_idem())
        resp = api.post(
            reverse("cashier-shift-close", args=[opened.data["id"]]),
            {"counted_amount": "100.00"}, format="json", headers=_idem(),
        )
        assert resp.status_code == 200
        assert resp.data["status"] == CashierShiftStatus.CLOSED
        assert resp.data["variance"] == "0.00"
        assert resp.data["approved_by"] is None

    def test_a_secretary_closing_with_a_variance_alone_is_forbidden(self, api, secretary):
        api.force_authenticate(secretary)
        opened = api.post(reverse("cashier-shift-open"), {
            "till_id": "T5", "opening_float": "100.00",
        }, format="json", headers=_idem())
        resp = api.post(
            reverse("cashier-shift-close", args=[opened.data["id"]]),
            {"counted_amount": "115.00", "reason_code": "unexplained_over"},
            format="json", headers=_idem(),
        )
        assert resp.status_code == 403
        shift = CashierShift.objects.get(pk=opened.data["id"])
        assert shift.status == CashierShiftStatus.OPEN  # nothing half-closed

    def test_a_manager_can_close_a_shift_with_a_variance(self, api, secretary, manager):
        api.force_authenticate(secretary)
        opened = api.post(reverse("cashier-shift-open"), {
            "till_id": "T6", "opening_float": "100.00",
        }, format="json", headers=_idem())

        api.force_authenticate(manager)
        resp = api.post(
            reverse("cashier-shift-close", args=[opened.data["id"]]),
            {"counted_amount": "115.00", "reason_code": "unexplained_over"},
            format="json", headers=_idem(),
        )
        assert resp.status_code == 200
        assert resp.data["variance"] == "15.00"
        assert resp.data["approved_by"] == manager.id

    def test_a_manager_closing_with_a_variance_but_no_reason_code_is_400(
        self, api, secretary, manager,
    ):
        api.force_authenticate(secretary)
        opened = api.post(reverse("cashier-shift-open"), {
            "till_id": "T7", "opening_float": "100.00",
        }, format="json", headers=_idem())

        api.force_authenticate(manager)
        resp = api.post(
            reverse("cashier-shift-close", args=[opened.data["id"]]),
            {"counted_amount": "80.00"}, format="json", headers=_idem(),
        )
        assert resp.status_code == 400

    def test_closing_an_already_closed_shift_is_400_not_500(self, api, secretary):
        api.force_authenticate(secretary)
        opened = api.post(
            reverse("cashier-shift-open"), {"till_id": "T8"}, format="json", headers=_idem(),
        )
        api.post(
            reverse("cashier-shift-close", args=[opened.data["id"]]),
            {"counted_amount": "0.00"}, format="json", headers=_idem(),
        )
        resp = api.post(
            reverse("cashier-shift-close", args=[opened.data["id"]]),
            {"counted_amount": "0.00"}, format="json", headers=_idem(),
        )
        assert resp.status_code == 400

    def test_patient_cannot_open_a_shift(self, api, patient):
        api.force_authenticate(patient)
        resp = api.post(
            reverse("cashier-shift-open"), {"till_id": "T9"}, format="json", headers=_idem(),
        )
        assert resp.status_code == 403


class TestFullScenarioTrialBalanceViaAPI:
    def test_credit_note_refund_and_cancel_all_leave_the_ledger_balanced(
        self, api, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        api.force_authenticate(secretary)
        api.post(reverse("payment-list"), {
            "invoice": invoice.id, "amount": "100.00", "payment_method": "CASH",
        }, format="json", headers=_idem())

        api.force_authenticate(manager)
        api.post(
            reverse("invoice-refund", args=[invoice.id]),
            {"amount": "20.00", "payment_method": "CASH", "reason_code": "overcharge"},
            format="json", headers=_idem(),
        )

        invoice2 = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        api.post(
            reverse("invoice-cancel", args=[invoice2.id]),
            {"reason_code": "duplicate"}, format="json", headers=_idem(),
        )

        tb = accounting_services.trial_balance()
        assert tb["is_balanced"]
