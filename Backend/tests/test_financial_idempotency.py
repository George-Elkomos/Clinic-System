"""Production-readiness hardening — API/business-level idempotency for
financial write operations, layered on top of (and never replacing) the
ledger's own `JournalEntry.idempotency_key`.

Vulnerability this closes: `issue_refund`/`issue_credit_note`/
`record_cash_movement`/`record_payment` each create a *new* domain row before
deriving their ledger posting key from that row's own pk — so retrying the
same logical request (a lost response, a double-click, a network timeout)
used to create a second, distinct financial record. See
`apps/billing/idempotency.py` and `IdempotentRequest` (models.py) for the
design: a `(user, operation, key)`-scoped claim, made inside the same
transaction as the operation it protects.

`cancel_invoice`/`open_shift`/`close_shift` were audited and found already
safe (a retry hits an existing state guard before anything duplicable
happens) — deliberately not touched, and not re-tested for idempotency here
(their existing test files already cover their normal behaviour).
"""
import threading
import uuid
from decimal import Decimal

import pytest
from django.db import IntegrityError
from django.db import transaction as db_transaction
from django.urls import reverse
from rest_framework.exceptions import ValidationError

from apps.accounting import services as accounting_services
from apps.accounting.models import JournalEntry
from apps.appointments import services as appointment_services
from apps.billing import services as billing_services
from apps.billing.exceptions import (
    IdempotencyKeyConflictError,
    IdempotencyRequestInProgressError,
)
from apps.billing.models import CashMovement, CreditNote, IdempotentRequest, Invoice, Payment, Refund, ServiceItem
from apps.core.enums import CashMovementType, FinancialOperation, PaymentMethod, RoleChoices, ServiceItemType

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
    return make_user("idem-manager@test.dev", RoleChoices.MANAGER)


@pytest.fixture
def other_manager(make_user):
    return make_user("idem-manager2@test.dev", RoleChoices.MANAGER)


@pytest.fixture
def secretary(make_user):
    return make_user("idem-secretary@test.dev", RoleChoices.SECRETARY)


@pytest.fixture
def cashier(make_user):
    return make_user("idem-cashier@test.dev", RoleChoices.SECRETARY)


def _issued_invoice(consultation_item, patient, doctor_profile, secretary):
    appointment = appointment_services.create_walk_in(
        patient=patient.patient_profile, doctor=doctor_profile, created_by=secretary,
    )
    appointment_services.complete_appointment(appointment, user=secretary)
    return Invoice.objects.get(patient=patient)  # total 100.00


@pytest.fixture
def shift(cashier):
    return billing_services.open_shift(cashier=cashier, till_id="IDEM1", opening_float=Decimal("200.00"))


# --- A. Basic retry (service layer) -------------------------------------------

class TestBasicRetryServiceLayer:
    def test_refund_retried_with_the_same_key_creates_exactly_one_refund(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        billing_services.record_payment(
            invoice=invoice, amount=Decimal("100.00"),
            payment_method=PaymentMethod.CASH, received_by=secretary,
        )
        key = str(uuid.uuid4())
        kwargs = dict(
            invoice=invoice, amount=Decimal("40.00"), payment_method=PaymentMethod.CASH,
            reason_code="overcharge", approved_by=manager, idempotency_key=key,
        )
        first = billing_services.issue_refund(**kwargs)
        second = billing_services.issue_refund(**kwargs)

        assert first.pk == second.pk
        assert Refund.objects.filter(invoice=invoice).count() == 1
        assert JournalEntry.objects.filter(source_type="Refund", source_id=first.id).count() == 1

    def test_credit_note_retried_with_the_same_key_creates_exactly_one(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        key = str(uuid.uuid4())
        kwargs = dict(
            invoice=invoice, amount=Decimal("30.00"), reason_code="goodwill",
            approved_by=manager, idempotency_key=key,
        )
        first = billing_services.issue_credit_note(**kwargs)
        second = billing_services.issue_credit_note(**kwargs)

        assert first.pk == second.pk
        assert CreditNote.objects.filter(invoice=invoice).count() == 1
        invoice.refresh_from_db()
        assert invoice.credited_amount == Decimal("30.00")  # not double-applied

    def test_cash_movement_retried_with_the_same_key_creates_exactly_one(self, shift, cashier):
        key = str(uuid.uuid4())
        kwargs = dict(
            shift=shift, movement_type=CashMovementType.FLOAT_IN, amount=Decimal("50.00"),
            reason="top-up", created_by=cashier, idempotency_key=key,
        )
        first = billing_services.record_cash_movement(**kwargs)
        second = billing_services.record_cash_movement(**kwargs)

        assert first.pk == second.pk
        assert CashMovement.objects.filter(shift=shift).count() == 1
        assert billing_services.expected_cash(shift) == Decimal("250.00")  # not double-counted

    def test_payment_retried_with_the_same_key_creates_exactly_one(
        self, consultation_item, patient, doctor_profile, secretary,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        key = str(uuid.uuid4())
        kwargs = dict(
            invoice=invoice, amount=Decimal("40.00"), payment_method=PaymentMethod.CASH,
            received_by=secretary, idempotency_key=key,
        )
        first = billing_services.record_payment(**kwargs)
        second = billing_services.record_payment(**kwargs)

        assert first.pk == second.pk
        assert Payment.objects.filter(invoice=invoice).count() == 1
        invoice.refresh_from_db()
        assert invoice.paid_amount == Decimal("40.00")  # not double-applied


# --- A (continued). Basic retry through the actual HTTP API ------------------

class TestBasicRetryAPI:
    def test_refund_retried_through_the_api_returns_the_same_object(
        self, api, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        api.force_authenticate(secretary)
        api.post(reverse("payment-list"), {
            "invoice": invoice.id, "amount": "100.00", "payment_method": "CASH",
        }, format="json", headers=_idem())

        api.force_authenticate(manager)
        headers = _idem()
        body = {"amount": "40.00", "payment_method": "CASH", "reason_code": "overcharge"}
        first = api.post(reverse("invoice-refund", args=[invoice.id]), body, format="json", headers=headers)
        second = api.post(reverse("invoice-refund", args=[invoice.id]), body, format="json", headers=headers)

        assert first.status_code == second.status_code == 201
        assert first.data["id"] == second.data["id"]
        assert Refund.objects.filter(invoice=invoice).count() == 1


# --- B. Different payload / same key ------------------------------------------

class TestSamePayloadDifferentPayload:
    def test_refund_same_key_different_amount_is_409_and_no_second_refund(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        billing_services.record_payment(
            invoice=invoice, amount=Decimal("100.00"),
            payment_method=PaymentMethod.CASH, received_by=secretary,
        )
        key = str(uuid.uuid4())
        billing_services.issue_refund(
            invoice=invoice, amount=Decimal("40.00"), payment_method=PaymentMethod.CASH,
            reason_code="overcharge", approved_by=manager, idempotency_key=key,
        )
        with pytest.raises(IdempotencyKeyConflictError):
            billing_services.issue_refund(
                invoice=invoice, amount=Decimal("70.00"), payment_method=PaymentMethod.CASH,
                reason_code="overcharge", approved_by=manager, idempotency_key=key,
            )
        assert Refund.objects.filter(invoice=invoice).count() == 1

        tb = accounting_services.trial_balance()
        assert tb["is_balanced"]

    def test_credit_note_same_key_different_reason_is_conflict(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        key = str(uuid.uuid4())
        billing_services.issue_credit_note(
            invoice=invoice, amount=Decimal("30.00"), reason_code="goodwill",
            approved_by=manager, idempotency_key=key,
        )
        with pytest.raises(IdempotencyKeyConflictError):
            billing_services.issue_credit_note(
                invoice=invoice, amount=Decimal("30.00"), reason_code="pricing_error",
                approved_by=manager, idempotency_key=key,
            )
        assert CreditNote.objects.filter(invoice=invoice).count() == 1

    def test_cash_movement_same_key_different_shift_is_conflict(self, cashier, manager):
        shift_a = billing_services.open_shift(cashier=cashier, till_id="IDEM-A")
        shift_b = billing_services.open_shift(cashier=manager, till_id="IDEM-B")
        key = str(uuid.uuid4())
        billing_services.record_cash_movement(
            shift=shift_a, movement_type=CashMovementType.FLOAT_IN,
            amount=Decimal("10.00"), reason="x", created_by=cashier, idempotency_key=key,
        )
        # Same user would be needed to collide at all — use the same cashier
        # against a *different* shift to isolate the "different target" case
        # from the "different user" case tested separately below.
        with pytest.raises(IdempotencyKeyConflictError):
            billing_services.record_cash_movement(
                shift=shift_b, movement_type=CashMovementType.FLOAT_IN,
                amount=Decimal("10.00"), reason="x", created_by=cashier, idempotency_key=key,
            )
        assert CashMovement.objects.count() == 1

    def test_conflict_response_via_api_is_409_with_stable_code(
        self, api, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        api.force_authenticate(manager)
        headers = _idem()
        api.post(
            reverse("invoice-credit-note", args=[invoice.id]),
            {"amount": "10.00", "reason_code": "a"}, format="json", headers=headers,
        )
        resp = api.post(
            reverse("invoice-credit-note", args=[invoice.id]),
            {"amount": "20.00", "reason_code": "a"}, format="json", headers=headers,
        )
        assert resp.status_code == 409
        assert resp.data["code"] == "idempotency_key_reused_with_different_request"
        assert CreditNote.objects.filter(invoice=invoice).count() == 1


# --- C. Different target / same key -------------------------------------------

class TestDifferentTargetSameKey:
    def test_same_key_different_invoice_is_rejected(
        self, consultation_item, patient, patient2, doctor_profile, secretary, manager,
    ):
        invoice_a = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        invoice_b = _issued_invoice(consultation_item, patient2, doctor_profile, secretary)
        key = str(uuid.uuid4())
        billing_services.issue_credit_note(
            invoice=invoice_a, amount=Decimal("10.00"), reason_code="a",
            approved_by=manager, idempotency_key=key,
        )
        with pytest.raises(IdempotencyKeyConflictError):
            billing_services.issue_credit_note(
                invoice=invoice_b, amount=Decimal("10.00"), reason_code="a",
                approved_by=manager, idempotency_key=key,
            )
        assert CreditNote.objects.filter(invoice=invoice_a).count() == 1
        assert CreditNote.objects.filter(invoice=invoice_b).count() == 0


# --- D. Different operation / same key ----------------------------------------

class TestDifferentOperationSameKey:
    def test_the_same_raw_key_is_independent_across_operation_types(
        self, consultation_item, patient, doctor_profile, secretary, manager, shift,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        key = str(uuid.uuid4())

        credit_note = billing_services.issue_credit_note(
            invoice=invoice, amount=Decimal("10.00"), reason_code="a",
            approved_by=manager, idempotency_key=key,
        )
        movement = billing_services.record_cash_movement(
            shift=shift, movement_type=CashMovementType.FLOAT_IN, amount=Decimal("10.00"),
            reason="a", created_by=manager, idempotency_key=key,
        )
        assert credit_note.pk and movement.pk  # both succeeded, no cross-operation collision
        assert IdempotentRequest.objects.filter(key=key).count() == 2


# --- E. Different user / same key ---------------------------------------------

class TestDifferentUserSameKey:
    def test_two_managers_using_the_same_raw_key_do_not_collide(
        self, consultation_item, patient, patient2, doctor_profile, secretary, manager, other_manager,
    ):
        invoice_a = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        invoice_b = _issued_invoice(consultation_item, patient2, doctor_profile, secretary)
        key = str(uuid.uuid4())

        note_a = billing_services.issue_credit_note(
            invoice=invoice_a, amount=Decimal("10.00"), reason_code="a",
            approved_by=manager, idempotency_key=key,
        )
        note_b = billing_services.issue_credit_note(
            invoice=invoice_b, amount=Decimal("20.00"), reason_code="b",
            approved_by=other_manager, idempotency_key=key,
        )
        assert note_a.pk != note_b.pk
        assert CreditNote.objects.count() == 2


# --- F. Real concurrency -------------------------------------------------------

class TestRealConcurrency:
    @pytest.mark.django_db(transaction=True)
    def test_concurrent_identical_refund_requests_produce_exactly_one_refund(self):
        """Real threads, real PostgreSQL — the same pattern as
        test_accounting_ledger.py's idempotency-key race test."""
        from calendar import monthrange
        from datetime import date

        from django.core.management import call_command
        from django.db import connection
        from django.utils import timezone as dj_tz2

        from apps.accounting.models import FiscalYear, Period
        from apps.core.enums import RoleChoices as RC
        from apps.doctors.models import DoctorProfile, Specialty, SpecialtyCategory, WorkingSchedule
        from apps.users.models import User

        # A `transaction=True` (TransactionTestCase-style) test flushes the
        # whole database afterwards, which wipes the session-scoped chart of
        # accounts / period seeded by conftest's `django_db_setup` override —
        # re-seed both here, the same way conftest does for the whole session.
        call_command("seed_chart_of_accounts", verbosity=0)
        today = dj_tz2.localdate()
        fiscal_year, _ = FiscalYear.objects.get_or_create(
            name=f"FY-idem-race-{today.year}",
            defaults={"start_date": date(today.year, 1, 1), "end_date": date(today.year, 12, 31)},
        )
        if Period.for_date(today) is None:
            last_day = monthrange(today.year, today.month)[1]
            Period.objects.create(
                fiscal_year=fiscal_year, name=today.strftime("%Y-%m"),
                start_date=date(today.year, today.month, 1),
                end_date=date(today.year, today.month, last_day),
            )

        # transaction=True tests don't get the module fixtures (they run
        # outside the usual per-test rollback), so the small amount of setup
        # needed is built directly here.
        patient_user = User.objects.create_user(
            email="idem-race-patient@test.dev", password="Clinic123!", role=RC.PATIENT,
        )
        secretary = User.objects.create_user(
            email="idem-race-secretary@test.dev", password="Clinic123!", role=RC.SECRETARY,
        )
        manager = User.objects.create_user(
            email="idem-race-manager@test.dev", password="Clinic123!", role=RC.MANAGER,
        )
        doctor_user = User.objects.create_user(
            email="idem-race-doctor@test.dev", password="Clinic123!", role=RC.DOCTOR,
        )
        category = SpecialtyCategory.objects.create(name="Race-General")
        specialty = Specialty.objects.create(name="Race-Practice", category=category)
        doctor_profile = DoctorProfile.objects.create(
            user=doctor_user, license_number="LIC-RACE", avg_appointment_duration=30,
        )
        doctor_profile.specialties.add(specialty)
        from django.utils import timezone as dj_tz
        from datetime import time as dtime
        WorkingSchedule.objects.create(
            doctor=doctor_profile, weekday=dj_tz.localdate().weekday(),
            start_time=dtime(0, 0), end_time=dtime(23, 0), valid_from=dj_tz.localdate(),
        )
        ServiceItem.objects.create(
            name="Race Consultation", item_type=ServiceItemType.CONSULTATION,
            default_price=Decimal("100.00"),
        )
        invoice = _issued_invoice(consultation_item=None, patient=patient_user,
                                   doctor_profile=doctor_profile, secretary=secretary)
        billing_services.record_payment(
            invoice=invoice, amount=Decimal("100.00"),
            payment_method=PaymentMethod.CASH, received_by=secretary,
        )

        key = str(uuid.uuid4())
        results = []
        errors = []
        barrier = threading.Barrier(2)

        def _worker():
            try:
                barrier.wait(timeout=5)
                refund = billing_services.issue_refund(
                    invoice=invoice, amount=Decimal("40.00"), payment_method=PaymentMethod.CASH,
                    reason_code="overcharge", approved_by=manager, idempotency_key=key,
                )
                results.append(refund.pk)
            except Exception as exc:  # pragma: no cover - failure path only
                errors.append(exc)
            finally:
                connection.close()

        t1 = threading.Thread(target=_worker)
        t2 = threading.Thread(target=_worker)
        t1.start()
        t2.start()
        t1.join()
        t2.join()

        assert errors == []
        assert len(results) == 2
        assert results[0] == results[1]
        assert Refund.objects.filter(invoice=invoice).count() == 1
        assert JournalEntry.objects.filter(source_type="Refund").count() == 1

        tb = accounting_services.trial_balance()
        assert tb["is_balanced"]


# --- G. Rollback ---------------------------------------------------------------

class TestRollbackDoesNotPoisonTheKey:
    def test_a_failed_refund_attempt_leaves_the_key_retryable(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        """The first attempt asks for more than was ever collected — it fails
        validation *after* the key would have been claimed, inside the same
        transaction, so the claim rolls back with it. A second attempt with
        the exact same key and a *valid* amount must succeed normally,
        proving the key was never permanently consumed by the failure."""
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        billing_services.record_payment(
            invoice=invoice, amount=Decimal("50.00"),
            payment_method=PaymentMethod.CASH, received_by=secretary,
        )
        key = str(uuid.uuid4())

        with pytest.raises(ValidationError):
            billing_services.issue_refund(
                invoice=invoice, amount=Decimal("999.00"), payment_method=PaymentMethod.CASH,
                reason_code="overcharge", approved_by=manager, idempotency_key=key,
            )
        assert not IdempotentRequest.objects.filter(key=key).exists()
        assert Refund.objects.filter(invoice=invoice).count() == 0

        refund = billing_services.issue_refund(
            invoice=invoice, amount=Decimal("30.00"), payment_method=PaymentMethod.CASH,
            reason_code="overcharge", approved_by=manager, idempotency_key=key,
        )
        assert refund.pk is not None
        assert Refund.objects.filter(invoice=invoice).count() == 1

        tb = accounting_services.trial_balance()
        assert tb["is_balanced"]

    def test_an_in_progress_row_with_no_completion_is_treated_as_a_conflict(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        """Defensive coverage for the (practically unreachable in normal
        operation — see IdempotentRequest's docstring) case of a row that
        somehow persisted without ever being marked COMPLETED."""
        from apps.billing import idempotency as idempotency_module

        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        fingerprint = idempotency_module.compute_fingerprint(
            invoice_id=invoice.pk, amount=Decimal("10.00"), reason_code="a",
        )
        IdempotentRequest.objects.create(
            user=manager, operation=FinancialOperation.ISSUE_CREDIT_NOTE,
            key="stuck-key", fingerprint=fingerprint,
        )
        with pytest.raises(IdempotencyRequestInProgressError):
            billing_services.issue_credit_note(
                invoice=invoice, amount=Decimal("10.00"), reason_code="a",
                approved_by=manager, idempotency_key="stuck-key",
            )


# --- H. Permission precedes replay ---------------------------------------------

class TestPermissionPrecedesReplay:
    def test_an_unauthorized_user_reusing_a_valid_key_still_gets_403(
        self, api, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        shared_key = str(uuid.uuid4())

        api.force_authenticate(manager)
        first = api.post(
            reverse("invoice-credit-note", args=[invoice.id]),
            {"amount": "10.00", "reason_code": "a"}, format="json",
            headers={"Idempotency-Key": shared_key},
        )
        assert first.status_code == 201

        api.force_authenticate(secretary)
        resp = api.post(
            reverse("invoice-credit-note", args=[invoice.id]),
            {"amount": "10.00", "reason_code": "a"}, format="json",
            headers={"Idempotency-Key": shared_key},
        )
        assert resp.status_code == 403
        assert "id" not in resp.data  # never leaks the manager's CreditNote
        assert CreditNote.objects.filter(invoice=invoice).count() == 1


# --- I. Financial integrity after idempotency scenarios ------------------------

class TestFinancialIntegrityAssertions:
    def test_trial_balance_is_zero_after_a_mix_of_retries_and_conflicts(
        self, consultation_item, patient, doctor_profile, secretary, manager, shift, cashier,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        billing_services.record_payment(
            invoice=invoice, amount=Decimal("100.00"),
            payment_method=PaymentMethod.CASH, received_by=secretary,
            idempotency_key=str(uuid.uuid4()),
        )
        refund_key = str(uuid.uuid4())
        billing_services.issue_refund(
            invoice=invoice, amount=Decimal("20.00"), payment_method=PaymentMethod.CASH,
            reason_code="a", approved_by=manager, idempotency_key=refund_key,
        )
        billing_services.issue_refund(  # retry
            invoice=invoice, amount=Decimal("20.00"), payment_method=PaymentMethod.CASH,
            reason_code="a", approved_by=manager, idempotency_key=refund_key,
        )
        billing_services.record_cash_movement(
            shift=shift, movement_type=CashMovementType.BANK_DEPOSIT, amount=Decimal("30.00"),
            reason="banking run", created_by=cashier, idempotency_key=str(uuid.uuid4()),
        )

        assert Refund.objects.filter(invoice=invoice).count() == 1
        tb = accounting_services.trial_balance()
        assert tb["is_balanced"]
