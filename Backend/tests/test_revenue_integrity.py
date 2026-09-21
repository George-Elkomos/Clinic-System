"""Financial roadmap Task 16 — revenue-integrity check.

Every test in this file either proves a specific finding fires correctly, or
proves the checker never mutates anything while doing so. Several tests
build a deliberately-broken ledger row directly through the ORM, bypassing
`accounting.services.post`/billing's own services entirely — that is
intentional: those services already refuse to create the broken states this
job exists to detect, so simulating them for a test has to go around the
normal API, the same way a real corruption (a manual DB fix, a bypassed
code path, a future bug) would.
"""
import uuid
from datetime import timedelta
from decimal import Decimal

import pytest
from django.utils import timezone

from apps.accounting import integrity, tasks as accounting_tasks
from apps.accounting.models import Account, AccountMap, JournalEntry, JournalLine, Period
from apps.accounting import services as accounting_services
from apps.appointments import services as appointment_services
from apps.billing import services as billing_services
from apps.billing.models import (
    CashierShift,
    CashMovement,
    CreditNote,
    IdempotentRequest,
    Invoice,
    InvoiceNumberSequence,
    Payment,
    Refund,
    ServiceItem,
    WriteOff,
    WriteOffReversal,
)
from apps.core.enums import (
    CashMovementType,
    CashierShiftStatus,
    FinancialOperation,
    IdempotencyStatus,
    InvoiceStatus,
    PaymentMethod,
    RoleChoices,
    ServiceItemType,
)

pytestmark = pytest.mark.django_db


# --- Shared fixtures (same conventions as the other financial test files) ---

@pytest.fixture
def consultation_item():
    return ServiceItem.objects.create(
        name="General Consultation", item_type=ServiceItemType.CONSULTATION,
        default_price=Decimal("100.00"),
    )


@pytest.fixture
def manager(make_user):
    return make_user("integrity-manager@test.dev", RoleChoices.MANAGER)


@pytest.fixture
def secretary(make_user):
    return make_user("integrity-secretary@test.dev", RoleChoices.SECRETARY)


@pytest.fixture
def cashier(make_user):
    return make_user("integrity-cashier@test.dev", RoleChoices.SECRETARY)


def _issued_invoice(consultation_item, patient, doctor_profile, secretary):
    appointment = appointment_services.create_walk_in(
        patient=patient.patient_profile, doctor=doctor_profile, created_by=secretary,
    )
    appointment_services.complete_appointment(appointment, user=secretary)
    return Invoice.objects.get(patient=patient)  # total 100.00


def _raw_entry(*, user, lines, source_type="Invoice", source_id, idempotency_key=None, reverses=None):
    """Build a JournalEntry directly via the ORM, bypassing
    `accounting.services.post` — used only to simulate a corruption the real
    posting service already refuses to create."""
    period = Period.for_date(timezone.localdate())
    entry = JournalEntry.objects.create(
        posting_date=timezone.localdate(), period=period,
        source_type=source_type, source_id=source_id,
        idempotency_key=idempotency_key or f"test:{source_type}:{source_id}:{uuid.uuid4()}",
        description="test raw entry", created_by=user, reverses=reverses,
    )
    for line_no, (purpose, debit, credit) in enumerate(lines, start=1):
        account = AccountMap.resolve(purpose)
        JournalLine.objects.create(
            entry=entry, line_no=line_no, account=account,
            debit=debit, credit=credit,
        )
    return entry


def _finding_categories(result):
    return {f["category"] for f in result["findings"]}


def _findings_for(result, object_type, object_id):
    return [
        f for f in result["findings"]
        if f["object_type"] == object_type and f["object_id"] == object_id
    ]


def _snapshot_counts():
    return {
        "Invoice": Invoice.objects.count(),
        "Payment": Payment.objects.count(),
        "CreditNote": CreditNote.objects.count(),
        "Refund": Refund.objects.count(),
        "CashierShift": CashierShift.objects.count(),
        "CashMovement": CashMovement.objects.count(),
        "JournalEntry": JournalEntry.objects.count(),
        "JournalLine": JournalLine.objects.count(),
        "InvoiceNumberSequence": InvoiceNumberSequence.objects.count(),
        "IdempotentRequest": IdempotentRequest.objects.count(),
        "WriteOff": WriteOff.objects.count(),
        "WriteOffReversal": WriteOffReversal.objects.count(),
    }


# --- Healthy baseline --------------------------------------------------------

class TestHealthyData:
    def test_healthy_finance_data_has_no_critical_findings(
        self, consultation_item, patient, doctor_profile, secretary,
    ):
        _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        result = integrity.run_revenue_integrity_check()
        assert result["ok"] is True
        assert result["summary"]["critical"] == 0
        assert result["checks_failed"] == []

    def test_result_shape_is_plain_and_serialisable(
        self, consultation_item, patient, doctor_profile, secretary,
    ):
        import json

        _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        result = integrity.run_revenue_integrity_check()
        # Must round-trip through plain json.dumps with no custom encoder.
        json.dumps(result)
        assert set(result.keys()) == {"ok", "checked_at", "summary", "findings", "checks_failed"}
        assert isinstance(result["checked_at"], str)


# --- Ledger structure and balance -------------------------------------------

class TestLedgerBalance:
    def test_unbalanced_journal_entry_is_detected(self, manager):
        entry = _raw_entry(
            user=manager, source_id=999001,
            lines=[("CASH_DEFAULT", Decimal("50.00"), Decimal("0.00")),
                   ("AR_PATIENT", Decimal("0.00"), Decimal("40.00"))],
        )
        result = integrity.run_revenue_integrity_check()
        assert "ledger_balance" in _finding_categories(result)
        hit = _findings_for(result, "JournalEntry", entry.id)
        assert any(f["category"] == "ledger_balance" and f["severity"] == "critical" for f in hit)

    def test_zero_line_journal_entry_is_detected(self, manager):
        entry = _raw_entry(user=manager, source_id=999002, lines=[])
        result = integrity.run_revenue_integrity_check()
        hit = _findings_for(result, "JournalEntry", entry.id)
        assert any(f["category"] == "ledger_structure" for f in hit)
        # Not also double-reported as an imbalance.
        assert not any(f["category"] == "ledger_balance" for f in hit)

    def test_single_line_journal_entry_is_detected(self, manager):
        entry = _raw_entry(
            user=manager, source_id=999003,
            lines=[("CASH_DEFAULT", Decimal("10.00"), Decimal("0.00"))],
        )
        result = integrity.run_revenue_integrity_check()
        hit = _findings_for(result, "JournalEntry", entry.id)
        assert any(f["category"] == "ledger_structure" for f in hit)


# --- Invoice -> ledger integrity ---------------------------------------------

class TestInvoiceLedger:
    def test_missing_invoice_posting_is_detected(self, patient, doctor_profile):
        invoice = Invoice.objects.create(
            patient=patient, doctor=doctor_profile.user, status=InvoiceStatus.ISSUED,
            invoice_number="INV-90001",
        )
        result = integrity.run_revenue_integrity_check()
        hit = _findings_for(result, "Invoice", invoice.id)
        assert any(f["category"] == "invoice_ledger" for f in hit)

    def test_duplicate_original_invoice_posting_is_detected(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        # A second, distinct "original" posting against the same invoice —
        # the real service never does this; simulate it directly.
        _raw_entry(
            user=manager, source_type="Invoice", source_id=invoice.id,
            lines=[("CASH_DEFAULT", Decimal("10.00"), Decimal("0.00")),
                   ("AR_PATIENT", Decimal("0.00"), Decimal("10.00"))],
        )
        result = integrity.run_revenue_integrity_check()
        hit = _findings_for(result, "Invoice", invoice.id)
        assert any("original issue postings" in f["message"] for f in hit)

    def test_cancelled_invoice_with_correct_reversal_is_not_flagged(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        billing_services.cancel_invoice(invoice=invoice, reason_code="test", cancelled_by=manager)
        result = integrity.run_revenue_integrity_check()
        assert _findings_for(result, "Invoice", invoice.id) == []

    def test_cancelled_invoice_missing_reversal_is_flagged(
        self, patient, doctor_profile, manager,
    ):
        invoice = Invoice.objects.create(
            patient=patient, doctor=doctor_profile.user, status=InvoiceStatus.CANCELLED,
            invoice_number="INV-90002",
        )
        _raw_entry(
            user=manager, source_type="Invoice", source_id=invoice.id,
            idempotency_key=f"Invoice:{invoice.id}:issue",
            lines=[("CASH_DEFAULT", Decimal("10.00"), Decimal("0.00")),
                   ("AR_PATIENT", Decimal("0.00"), Decimal("10.00"))],
        )
        result = integrity.run_revenue_integrity_check()
        hit = _findings_for(result, "Invoice", invoice.id)
        assert any("no reversing entry" in f["message"] for f in hit)


# --- Payment -> ledger integrity ---------------------------------------------

class TestPaymentLedger:
    def test_missing_payment_posting_is_detected(
        self, consultation_item, patient, doctor_profile, secretary,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        payment = Payment.objects.create(
            invoice=invoice, amount=Decimal("50.00"), payment_method=PaymentMethod.CASH,
        )
        result = integrity.run_revenue_integrity_check()
        hit = _findings_for(result, "Payment", payment.id)
        assert any(f["category"] == "payment_ledger" for f in hit)

    def test_healthy_payment_is_not_flagged(
        self, consultation_item, patient, doctor_profile, secretary,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        payment = billing_services.record_payment(
            invoice=invoice, amount=Decimal("50.00"), payment_method=PaymentMethod.CASH,
            received_by=secretary, idempotency_key=str(uuid.uuid4()),
        )
        result = integrity.run_revenue_integrity_check()
        assert _findings_for(result, "Payment", payment.id) == []


# --- Credit note / refund integrity ------------------------------------------

class TestCorrectionLedger:
    def test_credit_note_missing_journal_link_is_detected(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        note = CreditNote.objects.create(
            invoice=invoice, amount=Decimal("10.00"), reason_code="test", approved_by=manager,
        )
        result = integrity.run_revenue_integrity_check()
        hit = _findings_for(result, "CreditNote", note.id)
        assert any(f["category"] == "correction_ledger" for f in hit)

    def test_refund_missing_journal_link_is_detected(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        billing_services.record_payment(
            invoice=invoice, amount=Decimal("100.00"), payment_method=PaymentMethod.CASH,
            received_by=secretary, idempotency_key=str(uuid.uuid4()),
        )
        refund = Refund.objects.create(
            invoice=invoice, amount=Decimal("10.00"), payment_method=PaymentMethod.CASH,
            reason_code="test", approved_by=manager,
        )
        result = integrity.run_revenue_integrity_check()
        hit = _findings_for(result, "Refund", refund.id)
        assert any(f["category"] == "correction_ledger" for f in hit)

    def test_healthy_credit_note_is_not_flagged(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        note = billing_services.issue_credit_note(
            invoice=invoice, amount=Decimal("10.00"), reason_code="test", approved_by=manager,
            idempotency_key=str(uuid.uuid4()),
        )
        result = integrity.run_revenue_integrity_check()
        assert _findings_for(result, "CreditNote", note.id) == []

    def test_legacy_null_role_snapshot_is_not_flagged(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        """NULL on approved_by_role deliberately means "historical role not
        captured" (financial roadmap Task 15) — never a finding on its own."""
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        note = billing_services.issue_credit_note(
            invoice=invoice, amount=Decimal("10.00"), reason_code="test", approved_by=manager,
            idempotency_key=str(uuid.uuid4()),
        )
        CreditNote.objects.filter(pk=note.pk).update(approved_by_role=None)
        result = integrity.run_revenue_integrity_check()
        assert _findings_for(result, "CreditNote", note.id) == []


# --- WriteOff / WriteOffReversal ledger integrity (financial roadmap Task 15) -

class TestWriteOffLedger:
    def test_healthy_write_off_is_not_flagged(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        write_off = billing_services.write_off_invoice(
            invoice=invoice, amount=Decimal("10.00"), reason_code="test", approved_by=manager,
            idempotency_key=str(uuid.uuid4()),
        )
        result = integrity.run_revenue_integrity_check()
        assert _findings_for(result, "WriteOff", write_off.id) == []

    def test_write_off_missing_journal_link_is_detected(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        write_off = WriteOff.objects.create(
            invoice=invoice, amount=Decimal("10.00"), reason_code="test",
            approved_by=manager, approved_by_role=RoleChoices.MANAGER,
        )
        result = integrity.run_revenue_integrity_check()
        hit = _findings_for(result, "WriteOff", write_off.id)
        assert any(f["category"] == "write_off_ledger" for f in hit)

    def test_write_off_journal_entry_with_wrong_source_is_detected(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        write_off = WriteOff.objects.create(
            invoice=invoice, amount=Decimal("10.00"), reason_code="test",
            approved_by=manager, approved_by_role=RoleChoices.MANAGER,
        )
        wrong_entry = _raw_entry(
            user=manager, source_type="Invoice", source_id=invoice.id,
            lines=[("BAD_DEBT_PATIENT", Decimal("10.00"), Decimal("0.00")),
                   ("AR_PATIENT", Decimal("0.00"), Decimal("10.00"))],
        )
        write_off.journal_entry = wrong_entry
        write_off.save(update_fields=["journal_entry"])

        result = integrity.run_revenue_integrity_check()
        hit = _findings_for(result, "WriteOff", write_off.id)
        messages = " ".join(f["message"] for f in hit)
        assert "source_type" in messages
        assert "idempotency_key" in messages  # the raw entry's key doesn't match the convention either

    def test_write_off_journal_entry_that_is_itself_a_reversal_is_detected(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        original = _raw_entry(
            user=manager, source_type="WriteOff", source_id=999998,
            lines=[("BAD_DEBT_PATIENT", Decimal("10.00"), Decimal("0.00")),
                   ("AR_PATIENT", Decimal("0.00"), Decimal("10.00"))],
        )
        fake_reversal = _raw_entry(
            user=manager, source_type="WriteOff", source_id=999998, reverses=original,
            lines=[("AR_PATIENT", Decimal("10.00"), Decimal("0.00")),
                   ("BAD_DEBT_PATIENT", Decimal("0.00"), Decimal("10.00"))],
        )
        write_off = WriteOff.objects.create(
            invoice=invoice, amount=Decimal("10.00"), reason_code="test",
            approved_by=manager, approved_by_role=RoleChoices.MANAGER,
            journal_entry=fake_reversal,
        )
        result = integrity.run_revenue_integrity_check()
        hit = _findings_for(result, "WriteOff", write_off.id)
        assert any("itself a reversal" in f["message"] for f in hit)

    def test_healthy_reversed_write_off_is_not_flagged(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        """The legitimate original + reversal pair (financial roadmap
        Task 15) must never be mistaken for a duplicate posting."""
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        write_off = billing_services.write_off_invoice(
            invoice=invoice, amount=Decimal("10.00"), reason_code="test", approved_by=manager,
        )
        reversal = billing_services.reverse_write_off(
            write_off=write_off, reason_code="reconsidered", reversed_by=manager,
        )
        assert JournalEntry.objects.filter(
            source_type="WriteOff", source_id=write_off.id,
        ).count() == 2  # original + reversal, legitimately

        result = integrity.run_revenue_integrity_check()
        assert _findings_for(result, "WriteOff", write_off.id) == []
        assert _findings_for(result, "WriteOffReversal", reversal.id) == []
        assert result["ok"] is True

    def test_reversal_missing_journal_link_is_detected(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        write_off = billing_services.write_off_invoice(
            invoice=invoice, amount=Decimal("10.00"), reason_code="test", approved_by=manager,
        )
        reversal = WriteOffReversal.objects.create(
            write_off=write_off, reason_code="test", reversed_by=manager,
            reversed_by_role=RoleChoices.MANAGER,
        )
        result = integrity.run_revenue_integrity_check()
        hit = _findings_for(result, "WriteOffReversal", reversal.id)
        assert any(f["category"] == "write_off_reversal_ledger" for f in hit)

    def test_reversal_journal_entry_that_does_not_reverse_the_original_is_detected(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        write_off = billing_services.write_off_invoice(
            invoice=invoice, amount=Decimal("10.00"), reason_code="test", approved_by=manager,
        )
        unrelated_entry = _raw_entry(
            user=manager, source_type="WriteOff", source_id=write_off.id,
            lines=[("BAD_DEBT_PATIENT", Decimal("10.00"), Decimal("0.00")),
                   ("AR_PATIENT", Decimal("0.00"), Decimal("10.00"))],
        )
        reversal = WriteOffReversal.objects.create(
            write_off=write_off, reason_code="test", reversed_by=manager,
            reversed_by_role=RoleChoices.MANAGER, journal_entry=unrelated_entry,
        )
        result = integrity.run_revenue_integrity_check()
        hit = _findings_for(result, "WriteOffReversal", reversal.id)
        assert any("not the original write-off posting" in f["message"] for f in hit)

    def test_ledger_reversal_without_a_business_reversal_record_is_detected(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        """Reverses the ledger entry directly (bypassing
        services.reverse_write_off entirely) — no WriteOffReversal row is
        ever created, which is exactly the gap this check exists for."""
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        write_off = billing_services.write_off_invoice(
            invoice=invoice, amount=Decimal("10.00"), reason_code="test", approved_by=manager,
        )
        accounting_services.reverse(
            write_off.journal_entry, reason_code="bypassed_reversal", user=manager,
        )
        assert not WriteOffReversal.objects.filter(write_off=write_off).exists()

        result = integrity.run_revenue_integrity_check()
        hit = _findings_for(result, "WriteOff", write_off.id)
        assert any(
            f["category"] == "write_off_reversal_ledger"
            and "no WriteOffReversal record exists" in f["message"]
            for f in hit
        )

    def test_orphan_write_off_source_is_flagged(self, manager):
        _raw_entry(
            user=manager, source_type="WriteOff", source_id=999999,
            lines=[("BAD_DEBT_PATIENT", Decimal("5.00"), Decimal("0.00")),
                   ("AR_PATIENT", Decimal("0.00"), Decimal("5.00"))],
        )
        result = integrity.run_revenue_integrity_check()
        hit = _findings_for(result, "WriteOff", 999999)
        assert any(f["category"] == "orphan_ledger_source" for f in hit)


# --- Invoice.written_off_amount aggregate consistency -------------------------

class TestInvoiceWriteOffAggregate:
    def test_correct_written_off_amount_is_not_flagged(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        billing_services.write_off_invoice(
            invoice=invoice, amount=Decimal("10.00"), reason_code="test", approved_by=manager,
        )
        result = integrity.run_revenue_integrity_check()
        assert _findings_for(result, "Invoice", invoice.id) == []

    def test_stale_persisted_written_off_amount_is_flagged(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        """Corrupts the persisted field directly (bypassing
        services._recompute_written_off_amount) — this check must derive its
        own expected value to catch exactly this."""
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        billing_services.write_off_invoice(
            invoice=invoice, amount=Decimal("10.00"), reason_code="test", approved_by=manager,
        )
        Invoice.objects.filter(pk=invoice.pk).update(written_off_amount=Decimal("999.00"))

        result = integrity.run_revenue_integrity_check()
        hit = _findings_for(result, "Invoice", invoice.id)
        assert any(f["category"] == "write_off_aggregate" for f in hit)

    def test_reversed_write_off_correctly_drops_out_of_the_aggregate(
        self, consultation_item, patient, doctor_profile, secretary, manager,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        write_off = billing_services.write_off_invoice(
            invoice=invoice, amount=Decimal("10.00"), reason_code="test", approved_by=manager,
        )
        billing_services.reverse_write_off(
            write_off=write_off, reason_code="reconsidered", reversed_by=manager,
        )
        result = integrity.run_revenue_integrity_check()
        assert not any(
            f["category"] == "write_off_aggregate" for f in _findings_for(result, "Invoice", invoice.id)
        )


# --- Invoice.balance sanity ----------------------------------------------------

class TestInvoiceBalanceNonNegative:
    def test_negative_balance_is_flagged(
        self, consultation_item, patient, doctor_profile, secretary,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        Invoice.objects.filter(pk=invoice.pk).update(balance=Decimal("-10.00"))

        result = integrity.run_revenue_integrity_check()
        hit = _findings_for(result, "Invoice", invoice.id)
        assert any(f["category"] == "invoice_balance" and f["severity"] == "critical" for f in hit)

    def test_healthy_positive_balance_is_not_flagged(
        self, consultation_item, patient, doctor_profile, secretary,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        result = integrity.run_revenue_integrity_check()
        assert not any(
            f["category"] == "invoice_balance" for f in _findings_for(result, "Invoice", invoice.id)
        )


# --- Cashier / cash-movement integrity ---------------------------------------

class TestCashierIntegrity:
    def test_nonzero_opening_float_with_valid_posting_is_not_flagged(self, cashier):
        shift = billing_services.open_shift(
            cashier=cashier, till_id="INTEG-1", opening_float=Decimal("200.00"),
        )
        result = integrity.run_revenue_integrity_check()
        assert _findings_for(result, "CashierShift", shift.id) == []

    def test_missing_opening_float_posting_is_flagged(self, cashier):
        shift = CashierShift.objects.create(
            cashier=cashier, till_id="INTEG-2", opening_float=Decimal("200.00"),
        )
        result = integrity.run_revenue_integrity_check()
        hit = _findings_for(result, "CashierShift", shift.id)
        assert any("opening float" in f["message"] for f in hit)

    def test_closed_shift_with_approved_variance_missing_posting_is_flagged(
        self, cashier, manager,
    ):
        # The DB's own `shift_variance_requires_reason_and_approval` constraint
        # already refuses a non-zero variance with no reason/approval — so
        # that combination can never exist to test. What it does NOT guard is
        # the ledger link: a fully-approved variance can still, in principle,
        # end up with no posting (e.g. a future bug), which is exactly what
        # this check exists to catch.
        shift = CashierShift.objects.create(
            cashier=cashier, till_id="INTEG-3", opening_float=Decimal("0.00"),
            status=CashierShiftStatus.CLOSED, closed_at=timezone.now(), closed_by=cashier,
            expected_amount=Decimal("0.00"), counted_amount=Decimal("50.00"),
            variance=Decimal("50.00"), variance_reason_code="test", approved_by=manager,
        )
        result = integrity.run_revenue_integrity_check()
        hit = _findings_for(result, "CashierShift", shift.id)
        messages = " ".join(f["message"] for f in hit)
        assert "no approved_by" not in messages
        assert "no linked ledger entry" in messages

    def test_zero_variance_closed_shift_without_journal_entry_is_not_flagged(
        self, cashier, manager,
    ):
        shift = billing_services.open_shift(
            cashier=cashier, till_id="INTEG-4", opening_float=Decimal("0.00"),
        )
        closed = billing_services.close_shift(
            shift=shift, counted_amount=billing_services.expected_cash(shift), closed_by=cashier,
        )
        assert closed.variance in (None, Decimal("0.00"))
        result = integrity.run_revenue_integrity_check()
        assert _findings_for(result, "CashierShift", shift.id) == []


# --- Idempotency / duplicate anomalies ---------------------------------------

class TestIdempotencyAnomalies:
    def test_stale_in_progress_idempotent_request_is_flagged(self, manager):
        req = IdempotentRequest.objects.create(
            user=manager, operation=FinancialOperation.ISSUE_REFUND,
            key=str(uuid.uuid4()), fingerprint="x" * 64,
            status=IdempotencyStatus.IN_PROGRESS,
        )
        old = timezone.now() - integrity.STALE_IDEMPOTENT_REQUEST_AGE - timedelta(minutes=1)
        IdempotentRequest.objects.filter(pk=req.pk).update(created_at=old)

        result = integrity.run_revenue_integrity_check()
        hit = _findings_for(result, "IdempotentRequest", req.id)
        assert any(f["severity"] == "warning" for f in hit)

    def test_recent_in_progress_idempotent_request_is_not_flagged(self, manager):
        req = IdempotentRequest.objects.create(
            user=manager, operation=FinancialOperation.ISSUE_REFUND,
            key=str(uuid.uuid4()), fingerprint="x" * 64,
            status=IdempotencyStatus.IN_PROGRESS,
        )
        result = integrity.run_revenue_integrity_check()
        assert _findings_for(result, "IdempotentRequest", req.id) == []


# --- Orphan ledger sources ----------------------------------------------------

class TestOrphanLedgerSources:
    def test_orphan_supported_source_is_flagged(self, manager):
        entry = _raw_entry(
            user=manager, source_type="Invoice", source_id=999999,
            lines=[("CASH_DEFAULT", Decimal("5.00"), Decimal("0.00")),
                   ("AR_PATIENT", Decimal("0.00"), Decimal("5.00"))],
        )
        result = integrity.run_revenue_integrity_check()
        hit = _findings_for(result, "Invoice", 999999)
        assert any(f["category"] == "orphan_ledger_source" for f in hit)

    def test_unknown_future_source_type_is_safely_ignored(self, manager):
        _raw_entry(
            user=manager, source_type="SomeFutureThing", source_id=123456,
            lines=[("CASH_DEFAULT", Decimal("5.00"), Decimal("0.00")),
                   ("AR_PATIENT", Decimal("0.00"), Decimal("5.00"))],
        )
        result = integrity.run_revenue_integrity_check()
        assert result["checks_failed"] == []
        assert _findings_for(result, "SomeFutureThing", 123456) == []


# --- Invoice-number / sequence integrity -------------------------------------

class TestInvoiceNumberIntegrity:
    def test_sequence_behind_highest_invoice_number_is_flagged(
        self, consultation_item, patient, doctor_profile, secretary,
    ):
        _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        InvoiceNumberSequence.objects.filter(scope="default").update(last_value=0)

        result = integrity.run_revenue_integrity_check()
        assert _findings_for(result, "InvoiceNumberSequence", "default") != []

    def test_missing_default_sequence_with_issued_invoices_is_flagged(
        self, consultation_item, patient, doctor_profile, secretary,
    ):
        _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        InvoiceNumberSequence.objects.filter(scope="default").delete()

        result = integrity.run_revenue_integrity_check()
        hit = _findings_for(result, "InvoiceNumberSequence", "default")
        assert any("No InvoiceNumberSequence" in f["message"] for f in hit)

    def test_healthy_sequence_state_is_not_flagged(
        self, consultation_item, patient, doctor_profile, secretary,
    ):
        _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        result = integrity.run_revenue_integrity_check()
        assert _findings_for(result, "InvoiceNumberSequence", "default") == []


# --- Existing report reconciliation reuse ------------------------------------

class TestArReconciliation:
    def test_forced_ar_drift_is_surfaced(
        self, consultation_item, patient, doctor_profile, secretary,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        Invoice.objects.filter(pk=invoice.pk).update(balance=Decimal("999.00"))

        result = integrity.run_revenue_integrity_check()
        assert any(f["category"] == "report_reconciliation" for f in result["findings"])


# --- Check isolation ----------------------------------------------------------

class TestCheckIsolation:
    def test_one_failing_check_does_not_prevent_the_rest(
        self, monkeypatch, patient, doctor_profile,
    ):
        def _boom():
            raise RuntimeError("simulated failure")

        monkeypatch.setattr(integrity, "_check_ledger_structure_and_balance", _boom)
        # A finding that should still surface from an unrelated, still-working check.
        Invoice.objects.create(
            patient=patient, doctor=doctor_profile.user, status=InvoiceStatus.ISSUED,
            invoice_number="INV-90003",
        )

        result = integrity.run_revenue_integrity_check()
        assert "ledger_structure_and_balance" in result["checks_failed"]
        assert result["summary"]["checks_run"] == 12
        assert any(f["category"] == "invoice_ledger" for f in result["findings"])
        assert result["ok"] is False


# --- Read-only / no-mutation guarantee ----------------------------------------

class TestNoMutation:
    def test_repeated_executions_do_not_modify_financial_records(
        self, consultation_item, patient, doctor_profile, secretary, manager, cashier,
    ):
        invoice = _issued_invoice(consultation_item, patient, doctor_profile, secretary)
        billing_services.record_payment(
            invoice=invoice, amount=Decimal("40.00"), payment_method=PaymentMethod.CASH,
            received_by=secretary, idempotency_key=str(uuid.uuid4()),
        )
        billing_services.issue_credit_note(
            invoice=invoice, amount=Decimal("5.00"), reason_code="test", approved_by=manager,
            idempotency_key=str(uuid.uuid4()),
        )
        shift = billing_services.open_shift(
            cashier=cashier, till_id="INTEG-5", opening_float=Decimal("100.00"),
        )
        billing_services.record_cash_movement(
            shift=shift, movement_type=CashMovementType.FLOAT_IN, amount=Decimal("20.00"),
            reason="test", created_by=cashier, idempotency_key=str(uuid.uuid4()),
        )
        write_off = billing_services.write_off_invoice(
            invoice=invoice, amount=Decimal("10.00"), reason_code="test", approved_by=manager,
            idempotency_key=str(uuid.uuid4()),
        )
        billing_services.reverse_write_off(
            write_off=write_off, reason_code="test", reversed_by=manager,
            idempotency_key=str(uuid.uuid4()),
        )
        # Also present: some genuinely broken rows, so checks that find
        # things still don't touch them while finding them.
        Invoice.objects.create(
            patient=patient, doctor=doctor_profile.user, status=InvoiceStatus.ISSUED,
            invoice_number="INV-90004",
        )

        before = _snapshot_counts()
        integrity.run_revenue_integrity_check()
        integrity.run_revenue_integrity_check()
        after = _snapshot_counts()

        assert before == after


# --- django-q wrapper ----------------------------------------------------------

class TestScheduledWrapper:
    def test_wrapper_invokes_the_same_service(self, monkeypatch):
        calls = []

        def _fake():
            calls.append(1)
            return {
                "ok": True, "checked_at": "x",
                "summary": {"total_findings": 0, "critical": 0, "warning": 0,
                            "checks_run": 0, "checks_failed": 0},
                "findings": [], "checks_failed": [],
            }

        monkeypatch.setattr(integrity, "run_revenue_integrity_check", _fake)
        result = accounting_tasks.run_revenue_integrity_check()
        assert calls == [1]
        assert result["ok"] is True

    def test_wrapper_returns_real_findings_unmodified(
        self, patient, doctor_profile,
    ):
        Invoice.objects.create(
            patient=patient, doctor=doctor_profile.user, status=InvoiceStatus.ISSUED,
            invoice_number="INV-90005",
        )
        direct = integrity.run_revenue_integrity_check()
        via_wrapper = accounting_tasks.run_revenue_integrity_check()
        assert direct["summary"] == via_wrapper["summary"]
