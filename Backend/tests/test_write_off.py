"""Financial roadmap Task 15 — write-offs, their reversal, and the
approval-threshold policy that gates them (and the pre-existing correction
operations it now also covers).

Every threshold defaults to "0.00" in settings (see clinic_project.settings.
base) — tests that need a *raised* threshold use `override_settings()`
rather than touching the checked-in settings/test.py, per this session's
explicit instruction.
"""
import threading
import uuid
from decimal import Decimal

import pytest
from django.db import IntegrityError, connection
from django.db import transaction as db_transaction
from django.test import override_settings
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.accounting import services as accounting_services
from apps.accounting.models import AccountMap, JournalEntry
from apps.appointments import services as appointment_services
from apps.billing import services as billing_services
from apps.billing.exceptions import ApprovalThresholdExceededError
from apps.billing.models import Invoice, PatientDeposit, ServiceItem, WriteOff, WriteOffReversal
from apps.core.enums import InvoiceStatus, PaymentMethod, RoleChoices, ServiceItemType

pytestmark = pytest.mark.django_db


@pytest.fixture
def consultation_item():
    return ServiceItem.objects.create(
        name="General Consultation", item_type=ServiceItemType.CONSULTATION,
        default_price=Decimal("100.00"),
    )


@pytest.fixture
def secretary(make_user):
    return make_user("wo-secretary@test.dev", RoleChoices.SECRETARY)


@pytest.fixture
def manager(make_user):
    return make_user("wo-manager@test.dev", RoleChoices.MANAGER)


def _issued_invoice(consultation_item, patient, doctor_profile, secretary):
    appointment = appointment_services.create_walk_in(
        patient=patient.patient_profile, doctor=doctor_profile, created_by=secretary,
    )
    appointment_services.complete_appointment(appointment, user=secretary)
    return Invoice.objects.get(patient=patient)  # total 100.00


def _entry_amount(entry):
    lines = list(entry.lines.all())
    debit = sum((line.debit for line in lines), Decimal("0.00"))
    credit = sum((line.credit for line in lines), Decimal("0.00"))
    assert debit == credit
    return debit


# --- Creation: business rules -------------------------------------------------

class TestWriteOffCreation:
    def test_manager_can_write_off_part_of_the_balance(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        write_off = billing_services.write_off_invoice(
            invoice=invoice, amount=Decimal("30.00"),
            reason_code="uncollectable", approved_by=manager,
        )
        invoice.refresh_from_db()
        assert invoice.written_off_amount == Decimal("30.00")
        assert invoice.balance == Decimal("70.00")
        assert write_off.approved_by == manager
        assert write_off.approved_by_role == RoleChoices.MANAGER

    def test_manager_can_write_off_the_full_remaining_balance(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        billing_services.write_off_invoice(
            invoice=invoice, amount=invoice.total,
            reason_code="uncollectable", approved_by=manager,
        )
        invoice.refresh_from_db()
        assert invoice.written_off_amount == Decimal("100.00")
        assert invoice.balance == Decimal("0.00")

    def test_repeated_partial_write_offs_stack_correctly(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        billing_services.write_off_invoice(
            invoice=invoice, amount=Decimal("30.00"), reason_code="first", approved_by=manager,
        )
        billing_services.write_off_invoice(
            invoice=invoice, amount=Decimal("20.00"), reason_code="second", approved_by=manager,
        )
        invoice.refresh_from_db()
        assert invoice.written_off_amount == Decimal("50.00")
        assert invoice.balance == Decimal("50.00")
        assert WriteOff.objects.filter(invoice=invoice).count() == 2

    def test_write_off_exceeding_the_remaining_balance_is_rejected(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        billing_services.write_off_invoice(
            invoice=invoice, amount=Decimal("70.00"), reason_code="first", approved_by=manager,
        )
        with pytest.raises(ValidationError):
            billing_services.write_off_invoice(
                invoice=invoice, amount=Decimal("40.00"), reason_code="too_much", approved_by=manager,
            )
        invoice.refresh_from_db()
        assert invoice.written_off_amount == Decimal("70.00")  # untouched

    def test_write_off_requires_a_reason_code(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        with pytest.raises(ValidationError):
            billing_services.write_off_invoice(
                invoice=invoice, amount=Decimal("10.00"), reason_code="", approved_by=manager,
            )

    def test_reason_code_is_mandatory_at_the_database_level(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        with pytest.raises(IntegrityError):
            with db_transaction.atomic():
                WriteOff.objects.create(
                    invoice=invoice, amount=Decimal("10.00"), reason_code="",
                    approved_by=manager, approved_by_role=RoleChoices.MANAGER,
                )

    def test_a_draft_invoice_cannot_be_written_off(self, patient, doctor_profile, manager):
        invoice = Invoice.objects.create(
            patient=patient, doctor=doctor_profile.user, status=InvoiceStatus.DRAFT,
        )
        with pytest.raises(ValidationError):
            billing_services.write_off_invoice(
                invoice=invoice, amount=Decimal("10.00"), reason_code="x", approved_by=manager,
            )

    def test_write_off_posts_a_balanced_entry_to_the_correct_accounts(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        write_off = billing_services.write_off_invoice(
            invoice=invoice, amount=Decimal("40.00"), reason_code="uncollectable", approved_by=manager,
        )
        entry = write_off.journal_entry
        assert entry is not None
        assert _entry_amount(entry) == Decimal("40.00")
        assert entry.lines.get(
            account=AccountMap.resolve("BAD_DEBT_PATIENT")
        ).debit == Decimal("40.00")
        ar_line = entry.lines.get(account=AccountMap.resolve("AR_PATIENT"))
        assert ar_line.credit == Decimal("40.00")
        assert ar_line.party_type == "Patient"
        assert ar_line.party_id == patient.id

    def test_write_off_does_not_delete(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        from apps.billing.exceptions import WriteOffImmutableError

        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        write_off = billing_services.write_off_invoice(
            invoice=invoice, amount=Decimal("10.00"), reason_code="x", approved_by=manager,
        )
        with pytest.raises(WriteOffImmutableError):
            write_off.delete()


# --- Idempotency and concurrency ----------------------------------------------

class TestWriteOffIdempotency:
    def test_same_key_same_payload_replays_safely(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        key = str(uuid.uuid4())
        kwargs = dict(
            invoice=invoice, amount=Decimal("30.00"), reason_code="uncollectable",
            approved_by=manager, idempotency_key=key,
        )
        first = billing_services.write_off_invoice(**kwargs)
        second = billing_services.write_off_invoice(**kwargs)
        assert first.pk == second.pk
        assert WriteOff.objects.filter(invoice=invoice).count() == 1
        assert JournalEntry.objects.filter(source_type="WriteOff", source_id=first.id).count() == 1

    def test_same_key_different_payload_conflicts(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        key = str(uuid.uuid4())
        billing_services.write_off_invoice(
            invoice=invoice, amount=Decimal("30.00"), reason_code="uncollectable",
            approved_by=manager, idempotency_key=key,
        )
        from apps.billing.exceptions import IdempotencyKeyConflictError
        with pytest.raises(IdempotencyKeyConflictError):
            billing_services.write_off_invoice(
                invoice=invoice, amount=Decimal("40.00"), reason_code="uncollectable",
                approved_by=manager, idempotency_key=key,
            )

    @pytest.mark.django_db(transaction=True)
    def test_concurrent_write_offs_cannot_exceed_the_receivable(self):
        """Real threads, real PostgreSQL — same pattern as
        test_financial_idempotency.py's TestRealConcurrency. A plain
        `django_db`-wrapped test keeps everything in one uncommitted
        transaction on the main connection, invisible to a second thread's
        own connection — `transaction=True` (and rebuilding fixtures by hand)
        is required for genuine cross-connection visibility here."""
        from calendar import monthrange
        from datetime import date, time as dtime

        from django.core.management import call_command
        from django.utils import timezone as dj_tz

        from apps.accounting.models import FiscalYear, Period
        from apps.doctors.models import DoctorProfile, Specialty, SpecialtyCategory, WorkingSchedule
        from apps.users.models import User

        call_command("seed_chart_of_accounts", verbosity=0)
        today = dj_tz.localdate()
        fiscal_year, _ = FiscalYear.objects.get_or_create(
            name=f"FY-wo-race-{today.year}",
            defaults={"start_date": date(today.year, 1, 1), "end_date": date(today.year, 12, 31)},
        )
        if Period.for_date(today) is None:
            last_day = monthrange(today.year, today.month)[1]
            Period.objects.create(
                fiscal_year=fiscal_year, name=today.strftime("%Y-%m"),
                start_date=date(today.year, today.month, 1),
                end_date=date(today.year, today.month, last_day),
            )

        patient_user = User.objects.create_user(
            email="wo-race-patient@test.dev", password="Clinic123!", role=RoleChoices.PATIENT,
        )
        secretary = User.objects.create_user(
            email="wo-race-secretary@test.dev", password="Clinic123!", role=RoleChoices.SECRETARY,
        )
        manager = User.objects.create_user(
            email="wo-race-manager@test.dev", password="Clinic123!", role=RoleChoices.MANAGER,
        )
        doctor_user = User.objects.create_user(
            email="wo-race-doctor@test.dev", password="Clinic123!", role=RoleChoices.DOCTOR,
        )
        category = SpecialtyCategory.objects.create(name="Race-General")
        specialty = Specialty.objects.create(name="Race-Practice", category=category)
        doctor_profile = DoctorProfile.objects.create(
            user=doctor_user, license_number="LIC-WO-RACE", avg_appointment_duration=30,
        )
        doctor_profile.specialties.add(specialty)
        WorkingSchedule.objects.create(
            doctor=doctor_profile, weekday=today.weekday(),
            start_time=dtime(0, 0), end_time=dtime(23, 0), valid_from=today,
        )
        ServiceItem.objects.create(
            name="Race Consultation", item_type=ServiceItemType.CONSULTATION,
            default_price=Decimal("100.00"),
        )
        appointment = appointment_services.create_walk_in(
            patient=patient_user.patient_profile, doctor=doctor_profile, created_by=secretary,
        )
        appointment_services.complete_appointment(appointment, user=secretary)
        invoice = Invoice.objects.get(patient=patient_user)  # total 100.00

        results = []
        errors = []
        barrier = threading.Barrier(2)

        def _worker():
            try:
                barrier.wait(timeout=5)
                write_off = billing_services.write_off_invoice(
                    invoice=invoice, amount=Decimal("60.00"),
                    reason_code="uncollectable", approved_by=manager,
                )
                results.append(write_off.pk)
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

        assert len(results) == 1, errors  # exactly one $60 write-off fit
        assert len(errors) == 1
        assert isinstance(errors[0], ValidationError)

        invoice.refresh_from_db()
        assert invoice.written_off_amount == Decimal("60.00")
        assert invoice.balance == Decimal("40.00")  # never negative, never double-applied


# --- Reversal ------------------------------------------------------------------

class TestWriteOffReversal:
    def test_manager_can_fully_reverse_a_write_off(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        write_off = billing_services.write_off_invoice(
            invoice=invoice, amount=Decimal("40.00"), reason_code="uncollectable", approved_by=manager,
        )
        reversal = billing_services.reverse_write_off(
            write_off=write_off, reason_code="patient_paid_after_all", reversed_by=manager,
        )
        invoice.refresh_from_db()
        assert invoice.written_off_amount == Decimal("0.00")
        assert invoice.balance == Decimal("100.00")
        assert reversal.reversed_by == manager
        assert reversal.reversed_by_role == RoleChoices.MANAGER

    def test_reversal_posts_the_exact_opposite_entry(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        write_off = billing_services.write_off_invoice(
            invoice=invoice, amount=Decimal("40.00"), reason_code="uncollectable", approved_by=manager,
        )
        reversal = billing_services.reverse_write_off(
            write_off=write_off, reason_code="patient_paid_after_all", reversed_by=manager,
        )
        entry = reversal.journal_entry
        assert entry is not None
        assert entry.reverses_id == write_off.journal_entry_id
        assert _entry_amount(entry) == Decimal("40.00")
        assert entry.lines.get(
            account=AccountMap.resolve("AR_PATIENT")
        ).debit == Decimal("40.00")
        assert entry.lines.get(
            account=AccountMap.resolve("BAD_DEBT_PATIENT")
        ).credit == Decimal("40.00")
        # The original write-off entry is completely untouched.
        write_off.journal_entry.refresh_from_db()
        assert write_off.journal_entry.reverses_id is None

    def test_partial_write_off_reversal_restores_only_that_share(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        first = billing_services.write_off_invoice(
            invoice=invoice, amount=Decimal("30.00"), reason_code="first", approved_by=manager,
        )
        billing_services.write_off_invoice(
            invoice=invoice, amount=Decimal("20.00"), reason_code="second", approved_by=manager,
        )
        billing_services.reverse_write_off(
            write_off=first, reason_code="reconsidered", reversed_by=manager,
        )
        invoice.refresh_from_db()
        assert invoice.written_off_amount == Decimal("20.00")  # only the second remains active
        assert invoice.balance == Decimal("80.00")

    def test_a_write_off_can_only_be_reversed_once(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        write_off = billing_services.write_off_invoice(
            invoice=invoice, amount=Decimal("40.00"), reason_code="uncollectable", approved_by=manager,
        )
        billing_services.reverse_write_off(
            write_off=write_off, reason_code="first_reversal", reversed_by=manager,
        )
        with pytest.raises(ValidationError):
            billing_services.reverse_write_off(
                write_off=write_off, reason_code="second_reversal", reversed_by=manager,
            )

    def test_one_reversal_only_is_enforced_at_the_database_level(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        write_off = billing_services.write_off_invoice(
            invoice=invoice, amount=Decimal("40.00"), reason_code="uncollectable", approved_by=manager,
        )
        billing_services.reverse_write_off(
            write_off=write_off, reason_code="first_reversal", reversed_by=manager,
        )
        with pytest.raises(IntegrityError):
            with db_transaction.atomic():
                WriteOffReversal.objects.create(
                    write_off=write_off, reason_code="direct_bypass", reversed_by=manager,
                    reversed_by_role=RoleChoices.MANAGER,
                )

    def test_reversal_requires_a_reason_code(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        write_off = billing_services.write_off_invoice(
            invoice=invoice, amount=Decimal("10.00"), reason_code="x", approved_by=manager,
        )
        with pytest.raises(ValidationError):
            billing_services.reverse_write_off(
                write_off=write_off, reason_code="", reversed_by=manager,
            )

    def test_secretary_cannot_reverse_a_write_off_regardless_of_amount(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        """threshold=None means unconditional manager-only — enforced inside
        the service, so a direct call (not just the DRF view) is bound by it."""
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        write_off = billing_services.write_off_invoice(
            invoice=invoice, amount=Decimal("1.00"), reason_code="tiny", approved_by=manager,
        )
        with pytest.raises(ApprovalThresholdExceededError):
            billing_services.reverse_write_off(
                write_off=write_off, reason_code="try_reverse", reversed_by=secretary,
            )
        assert not hasattr(write_off, "reversal") or WriteOffReversal.objects.filter(
            write_off=write_off
        ).count() == 0

    def test_reversal_idempotency_same_key_replays(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        write_off = billing_services.write_off_invoice(
            invoice=invoice, amount=Decimal("30.00"), reason_code="uncollectable", approved_by=manager,
        )
        key = str(uuid.uuid4())
        kwargs = dict(
            write_off=write_off, reason_code="patient_paid_after_all",
            reversed_by=manager, idempotency_key=key,
        )
        first = billing_services.reverse_write_off(**kwargs)
        second = billing_services.reverse_write_off(**kwargs)
        assert first.pk == second.pk
        assert WriteOffReversal.objects.filter(write_off=write_off).count() == 1

    def test_reversal_idempotency_same_key_different_payload_conflicts(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        write_off = billing_services.write_off_invoice(
            invoice=invoice, amount=Decimal("30.00"), reason_code="uncollectable", approved_by=manager,
        )
        key = str(uuid.uuid4())
        billing_services.reverse_write_off(
            write_off=write_off, reason_code="reason_a", reversed_by=manager, idempotency_key=key,
        )
        from apps.billing.exceptions import IdempotencyKeyConflictError
        with pytest.raises(IdempotencyKeyConflictError):
            billing_services.reverse_write_off(
                write_off=write_off, reason_code="reason_b", reversed_by=manager, idempotency_key=key,
            )


# --- Persisted-DB proof (not just the in-memory object) ------------------------

class TestPersistedBalanceAfterWriteOffAndReversal:
    def test_write_off_persists_written_off_amount_and_balance_after_reload(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        billing_services.write_off_invoice(
            invoice=invoice, amount=Decimal("35.00"), reason_code="uncollectable", approved_by=manager,
        )
        reloaded = Invoice.objects.get(pk=invoice.pk)
        assert reloaded.written_off_amount == Decimal("35.00")
        assert reloaded.balance == Decimal("65.00")

    def test_write_off_reversal_persists_written_off_amount_and_balance_after_reload(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        write_off = billing_services.write_off_invoice(
            invoice=invoice, amount=Decimal("35.00"), reason_code="uncollectable", approved_by=manager,
        )
        billing_services.reverse_write_off(
            write_off=write_off, reason_code="reconsidered", reversed_by=manager,
        )
        reloaded = Invoice.objects.get(pk=invoice.pk)
        assert reloaded.written_off_amount == Decimal("0.00")
        assert reloaded.balance == Decimal("100.00")


# --- Interaction with payment / cancellation -----------------------------------

class TestWriteOffInteractions:
    def test_payment_after_full_write_off_becomes_a_deposit_without_going_negative(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        billing_services.write_off_invoice(
            invoice=invoice, amount=invoice.total, reason_code="uncollectable", approved_by=manager,
        )
        billing_services.record_payment(
            invoice=invoice, amount=Decimal("25.00"),
            payment_method=PaymentMethod.CASH, received_by=secretary,
        )
        reloaded = Invoice.objects.get(pk=invoice.pk)
        assert reloaded.balance == Decimal("0.00")
        assert reloaded.paid_amount == Decimal("0.00")
        deposit = PatientDeposit.objects.get(patient=patient)
        assert deposit.amount == Decimal("25.00")

    def test_cancelling_an_invoice_with_an_active_write_off_is_refused(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        billing_services.write_off_invoice(
            invoice=invoice, amount=Decimal("30.00"), reason_code="uncollectable", approved_by=manager,
        )
        with pytest.raises(ValidationError):
            billing_services.cancel_invoice(
                invoice=invoice, reason_code="try_cancel", cancelled_by=manager,
            )
        invoice.refresh_from_db()
        assert invoice.status != InvoiceStatus.CANCELLED
        assert invoice.written_off_amount == Decimal("30.00")  # never overwritten

    def test_cancelling_after_a_write_off_is_reversed_succeeds(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        write_off = billing_services.write_off_invoice(
            invoice=invoice, amount=Decimal("30.00"), reason_code="uncollectable", approved_by=manager,
        )
        billing_services.reverse_write_off(
            write_off=write_off, reason_code="reconsidered", reversed_by=manager,
        )
        cancelled = billing_services.cancel_invoice(
            invoice=invoice, reason_code="booked_in_error", cancelled_by=manager,
        )
        assert cancelled.status == InvoiceStatus.CANCELLED


# --- Role snapshots -------------------------------------------------------------

class TestRoleSnapshots:
    def test_write_off_and_reversal_role_snapshots_are_populated(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        write_off = billing_services.write_off_invoice(
            invoice=invoice, amount=Decimal("10.00"), reason_code="x", approved_by=manager,
        )
        assert write_off.approved_by_role == RoleChoices.MANAGER
        reversal = billing_services.reverse_write_off(
            write_off=write_off, reason_code="y", reversed_by=manager,
        )
        assert reversal.reversed_by_role == RoleChoices.MANAGER

    def test_credit_note_and_refund_role_snapshots_are_populated_for_new_rows(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        note = billing_services.issue_credit_note(
            invoice=invoice, amount=Decimal("10.00"), reason_code="x", approved_by=manager,
        )
        assert note.approved_by_role == RoleChoices.MANAGER

        billing_services.record_payment(
            invoice=invoice, amount=Decimal("10.00"),
            payment_method=PaymentMethod.CASH, received_by=secretary,
        )
        refund = billing_services.issue_refund(
            invoice=invoice, amount=Decimal("5.00"), payment_method=PaymentMethod.CASH,
            reason_code="x", approved_by=manager,
        )
        assert refund.approved_by_role == RoleChoices.MANAGER

    def test_legacy_rows_created_without_a_role_snapshot_remain_null(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        """Simulates a pre-Task-15 row: created directly via the ORM (as if
        by a bypassed/older code path), never backfilled from the user's
        current role. NULL must remain an honest "not captured" state."""
        from apps.billing.models import CreditNote

        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        legacy_note = CreditNote.objects.create(
            invoice=invoice, amount=Decimal("5.00"), reason_code="legacy", approved_by=manager,
        )
        assert legacy_note.approved_by_role is None
        legacy_note.refresh_from_db()
        assert legacy_note.approved_by_role is None


# --- Threshold policy across every gated operation (direct service calls) -----

class TestThresholdPolicy:
    """Direct service calls, not the DRF view — proving the policy is
    enforced inside the locked transactional path itself, not only at the
    HTTP layer."""

    @override_settings(FINANCE_APPROVAL_THRESHOLD_WRITE_OFF="50.00")
    def test_secretary_within_a_raised_threshold_may_write_off_alone(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        write_off = billing_services.write_off_invoice(
            invoice=invoice, amount=Decimal("50.00"), reason_code="small", approved_by=secretary,
        )
        assert write_off.approved_by == secretary
        assert write_off.approved_by_role == RoleChoices.SECRETARY

    @override_settings(FINANCE_APPROVAL_THRESHOLD_WRITE_OFF="50.00")
    def test_secretary_above_a_raised_threshold_is_rejected(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        with pytest.raises(ApprovalThresholdExceededError):
            billing_services.write_off_invoice(
                invoice=invoice, amount=Decimal("50.01"), reason_code="too_big", approved_by=secretary,
            )

    @override_settings(FINANCE_APPROVAL_THRESHOLD_WRITE_OFF="50.00")
    def test_exact_threshold_boundary_is_inclusive_for_secretary(
        self, consultation_item, patient, doctor_profile, secretary, manager, patient2,
    ):
        # A single write-off of exactly the threshold succeeds...
        invoice_a = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        billing_services.write_off_invoice(
            invoice=invoice_a, amount=Decimal("50.00"), reason_code="exact", approved_by=secretary,
        )
        invoice_a.refresh_from_db()
        assert invoice_a.written_off_amount == Decimal("50.00")

        # ...but one cent more, in a single write-off, is rejected — on a
        # second (higher-total) invoice, so the rejection is provably the
        # threshold and not the separate remaining-balance cap.
        appointment_services.complete_appointment(
            appointment_services.create_walk_in(
                patient=patient2.patient_profile, doctor=doctor_profile, created_by=secretary,
            ),
            user=secretary,
        )
        invoice_b = Invoice.objects.get(patient=patient2)
        with pytest.raises(ApprovalThresholdExceededError):
            billing_services.write_off_invoice(
                invoice=invoice_b, amount=Decimal("50.01"), reason_code="one_cent_more",
                approved_by=secretary,
            )

    @override_settings(FINANCE_APPROVAL_THRESHOLD_WRITE_OFF="1000.00")
    def test_patient_is_rejected_regardless_of_amount_or_threshold(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        with pytest.raises(ApprovalThresholdExceededError):
            billing_services.write_off_invoice(
                invoice=invoice, amount=Decimal("1.00"), reason_code="x", approved_by=patient,
            )

    @override_settings(FINANCE_APPROVAL_THRESHOLD_WRITE_OFF="1000.00")
    def test_doctor_is_rejected_regardless_of_amount_or_threshold(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        with pytest.raises(ApprovalThresholdExceededError):
            billing_services.write_off_invoice(
                invoice=invoice, amount=Decimal("1.00"), reason_code="x",
                approved_by=doctor_profile.user,
            )

    def test_manager_is_always_allowed_regardless_of_threshold(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        # Default threshold is 0.00 — a manager must still succeed above it.
        write_off = billing_services.write_off_invoice(
            invoice=invoice, amount=Decimal("99.00"), reason_code="x", approved_by=manager,
        )
        assert write_off.approved_by_role == RoleChoices.MANAGER

    @override_settings(FINANCE_APPROVAL_THRESHOLD_CREDIT_NOTE="20.00")
    def test_secretary_within_raised_credit_note_threshold_succeeds(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        note = billing_services.issue_credit_note(
            invoice=invoice, amount=Decimal("20.00"), reason_code="small", approved_by=secretary,
        )
        assert note.approved_by_role == RoleChoices.SECRETARY

    @override_settings(FINANCE_APPROVAL_THRESHOLD_REFUND="20.00")
    def test_secretary_within_raised_refund_threshold_succeeds(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        billing_services.record_payment(
            invoice=invoice, amount=Decimal("100.00"),
            payment_method=PaymentMethod.CASH, received_by=secretary,
        )
        refund = billing_services.issue_refund(
            invoice=invoice, amount=Decimal("20.00"), payment_method=PaymentMethod.CASH,
            reason_code="small", approved_by=secretary,
        )
        assert refund.approved_by_role == RoleChoices.SECRETARY

    def test_cancellation_service_rejects_a_secretary_even_outside_drf(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        """cancel_invoice has no threshold concept at all — MANAGER-only,
        unconditionally, enforced inside the service itself."""
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        with pytest.raises(ApprovalThresholdExceededError):
            billing_services.cancel_invoice(
                invoice=invoice, reason_code="try_cancel", cancelled_by=secretary,
            )
        invoice.refresh_from_db()
        assert invoice.status != InvoiceStatus.CANCELLED

    def test_cancellation_service_rejects_a_patient_even_outside_drf(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        with pytest.raises(ApprovalThresholdExceededError):
            billing_services.cancel_invoice(
                invoice=invoice, reason_code="try_cancel", cancelled_by=patient,
            )

    def test_manager_cancellation_still_succeeds(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        cancelled = billing_services.cancel_invoice(
            invoice=invoice, reason_code="booked_in_error", cancelled_by=manager,
        )
        assert cancelled.status == InvoiceStatus.CANCELLED


# --- Cashier-close abs(variance) rule (direct service calls) ------------------

class TestCashierVarianceAbsRule:
    @pytest.fixture
    def shift(self, secretary):
        return billing_services.open_shift(
            cashier=secretary, till_id="WO-T1", opening_float=Decimal("200.00"),
        )

    @override_settings(FINANCE_APPROVAL_THRESHOLD_CASHIER_VARIANCE="10.00")
    def test_a_shortage_within_threshold_is_treated_like_an_overage_of_the_same_size(
        self, shift, secretary,
    ):
        """abs(variance) <= threshold — a -$10 shortage must be as
        permitted for a SECRETARY as a +$10 overage, not just the positive
        case."""
        closed = billing_services.close_shift(
            shift=shift, counted_amount=Decimal("190.00"), closed_by=secretary,
            reason_code="small_shortage",
        )
        assert closed.variance == Decimal("-10.00")
        assert closed.closed_by_role == RoleChoices.SECRETARY

    @override_settings(FINANCE_APPROVAL_THRESHOLD_CASHIER_VARIANCE="10.00")
    def test_an_overage_within_threshold_is_permitted_for_a_secretary(
        self, shift, secretary,
    ):
        closed = billing_services.close_shift(
            shift=shift, counted_amount=Decimal("210.00"), closed_by=secretary,
            reason_code="small_overage",
        )
        assert closed.variance == Decimal("10.00")

    @override_settings(FINANCE_APPROVAL_THRESHOLD_CASHIER_VARIANCE="10.00")
    def test_a_shortage_beyond_the_threshold_is_rejected_for_a_secretary(
        self, shift, secretary,
    ):
        with pytest.raises(ApprovalThresholdExceededError):
            billing_services.close_shift(
                shift=shift, counted_amount=Decimal("189.00"), closed_by=secretary,
                reason_code="big_shortage",
            )

    @override_settings(FINANCE_APPROVAL_THRESHOLD_CASHIER_VARIANCE="10.00")
    def test_manager_may_close_beyond_the_threshold(self, shift, manager):
        closed = billing_services.close_shift(
            shift=shift, counted_amount=Decimal("150.00"), closed_by=manager,
            reason_code="big_shortage",
        )
        assert closed.variance == Decimal("-50.00")
        assert closed.closed_by_role == RoleChoices.MANAGER
