"""Financial roadmap Task 14 — a real, gapless, transaction-safe invoice
number, replacing the old pk-derived `INV-{pk:05d}` display value.

`InvoiceNumberSequence` is deliberately not a Postgres `SEQUENCE`: `nextval()`
is never transactional, so a rolled-back transaction still permanently
consumes the value it drew. These tests exist specifically to prove the
opposite is true here — a rollback releases the number, concurrent creations
never collide, and nothing is ever renumbered.
"""
import threading
from decimal import Decimal

import pytest
from django.db import IntegrityError
from django.db import transaction as db_transaction

from apps.appointments import services as appointment_services
from apps.billing import services as billing_services
from apps.billing.exceptions import InvoiceNumberImmutableError
from apps.billing.models import Invoice, InvoiceNumberSequence, ServiceItem
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
    return make_user("inv-secretary@test.dev", RoleChoices.SECRETARY)


def _complete_visit(patient, doctor_profile, secretary):
    appointment = appointment_services.create_walk_in(
        patient=patient.patient_profile, doctor=doctor_profile, created_by=secretary,
    )
    return appointment_services.complete_appointment(appointment, user=secretary)


class TestSequentialAllocation:
    def test_two_invoices_in_a_row_get_consecutive_numbers(
        self, consultation_item, patient, patient2, doctor_profile, secretary,
    ):
        _complete_visit(patient, doctor_profile, secretary)
        _complete_visit(patient2, doctor_profile, secretary)

        first = Invoice.objects.get(patient=patient)
        second = Invoice.objects.get(patient=patient2)
        first_n = int(first.invoice_number.split("-")[1])
        second_n = int(second.invoice_number.split("-")[1])
        assert second_n == first_n + 1

    def test_the_number_is_independent_of_the_primary_key(
        self, consultation_item, patient, doctor_profile, secretary,
    ):
        """The sequence and the pk are two different counters — they need not
        agree, which is the whole point of decoupling them (Task 14). Forced
        deterministically (rather than relying on however many invoices
        earlier tests happened to create) by seeding the sequence far ahead
        of wherever the pk sequence currently is."""
        InvoiceNumberSequence.objects.update_or_create(
            scope="default", defaults={"last_value": 500_000},
        )
        _complete_visit(patient, doctor_profile, secretary)
        invoice = Invoice.objects.get(patient=patient)
        assert invoice.invoice_number == "INV-500001"
        assert invoice.pk < 500_000  # genuinely a different counter


class TestRollbackSafety:
    def test_a_rolled_back_invoice_creation_does_not_burn_a_number(self):
        seq_before = InvoiceNumberSequence.objects.get_or_create(scope="default")[0]
        value_before = seq_before.last_value

        with pytest.raises(IntegrityError):
            with db_transaction.atomic():
                billing_services.allocate_invoice_number()
                # Force the surrounding transaction to roll back after the
                # number was drawn — proving the increment rolls back with it.
                raise IntegrityError("simulated failure after allocation")

        seq_after = InvoiceNumberSequence.objects.get(scope="default")
        assert seq_after.last_value == value_before  # never actually consumed

        # And the *next* real allocation continues from the same point,
        # exactly as if the failed attempt had never happened — no gap.
        next_number = billing_services.allocate_invoice_number()
        assert next_number == f"INV-{value_before + 1:05d}"


class TestConcurrentAllocation:
    @pytest.mark.django_db(transaction=True)
    def test_concurrent_allocations_never_collide_or_skip(self):
        """Real threads, real PostgreSQL row locking — not a mocked race
        (same pattern as test_accounting_ledger.py's idempotency-key race
        test: `transaction=True` so each thread gets a real, separately
        committed transaction instead of a nested savepoint on one shared
        connection)."""
        from django.db import connection

        results = []
        errors = []
        barrier = threading.Barrier(5)

        def _allocate():
            try:
                barrier.wait(timeout=5)
                with db_transaction.atomic():
                    results.append(billing_services.allocate_invoice_number())
            except Exception as exc:  # pragma: no cover - failure path only
                errors.append(exc)
            finally:
                connection.close()

        threads = [threading.Thread(target=_allocate) for _ in range(5)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert not errors
        assert len(results) == len(set(results)) == 5  # all unique, none dropped

        numbers = sorted(int(n.split("-")[1]) for n in results)
        assert numbers == list(range(numbers[0], numbers[0] + 5))  # consecutive


class TestImmutability:
    def test_invoice_number_cannot_be_changed_after_issuance(
        self, consultation_item, patient, doctor_profile, secretary,
    ):
        _complete_visit(patient, doctor_profile, secretary)
        invoice = Invoice.objects.get(patient=patient)
        original = invoice.invoice_number

        invoice.invoice_number = "INV-99999"
        with pytest.raises(InvoiceNumberImmutableError):
            invoice.save(update_fields=["invoice_number"])

        invoice.refresh_from_db()
        assert invoice.invoice_number == original

    def test_saving_with_the_same_number_is_fine(
        self, consultation_item, patient, doctor_profile, secretary,
    ):
        _complete_visit(patient, doctor_profile, secretary)
        invoice = Invoice.objects.get(patient=patient)
        invoice.notes = "unrelated edit"
        invoice.save(update_fields=["notes", "updated_at"])  # must not raise


class TestUniqueness:
    def test_two_invoices_cannot_share_a_number_at_the_database_level(
        self, consultation_item, patient, patient2, doctor_profile, secretary,
    ):
        _complete_visit(patient, doctor_profile, secretary)
        first = Invoice.objects.get(patient=patient)
        with pytest.raises(IntegrityError):
            with db_transaction.atomic():
                Invoice.objects.create(
                    patient=patient2, doctor=doctor_profile.user,
                    invoice_number=first.invoice_number,
                )

    def test_blank_invoice_numbers_are_repeatable(self, patient, patient2, doctor_profile):
        """Legacy rows (pre-Task-14, backfilled by migration 0010 in
        production — never blank there) and any row created outside the
        service layer share the blank default; the partial unique constraint
        (condition=~Q(invoice_number="")) must not treat multiple blanks as a
        collision, mirroring InvoiceItem's existing source_id convention."""
        Invoice.objects.create(patient=patient, doctor=doctor_profile.user)
        Invoice.objects.create(patient=patient2, doctor=doctor_profile.user)  # must not raise


class TestBackwardCompatibleDisplayNumber:
    def test_a_blank_invoice_number_falls_back_to_the_old_pk_derived_display(self, patient):
        """Simulates a pre-Task-14 row that predates the backfill (in
        production, migration 0010 backfills every existing row so this
        never actually happens there — this test only proves the fallback
        itself still works, matching the exact format patients/receipts
        already saw before this task)."""
        invoice = Invoice.objects.create(patient=patient)
        assert invoice.invoice_number == ""
        assert invoice.number == f"INV-{invoice.pk:05d}"

    def test_an_allocated_number_is_used_verbatim_once_set(
        self, consultation_item, patient, doctor_profile, secretary,
    ):
        # Seeded far ahead of the pk sequence so the two are guaranteed to
        # disagree — not a coincidental match on whatever value each counter
        # happens to be at when this test runs in isolation.
        InvoiceNumberSequence.objects.update_or_create(
            scope="default", defaults={"last_value": 700_000},
        )
        _complete_visit(patient, doctor_profile, secretary)
        invoice = Invoice.objects.get(patient=patient)
        assert invoice.number == invoice.invoice_number == "INV-700001"
        assert invoice.number != f"INV-{invoice.pk:05d}"  # genuinely decoupled from pk
