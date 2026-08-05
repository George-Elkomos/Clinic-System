"""One-shot fixture for manually verifying Phase 12 (Basic Billing) without
walking through registration -> booking -> consultation every time.

    python manage.py seed_billing_e2e

Re-running is safe: it only tops up whatever a prior test round consumed
(e.g. an unpaid invoice that got fully paid off) and never touches other data.

What it guarantees on the e2e.* accounts (see .claude/skills/verify/SKILL.md
for the passwords/routes):
  - e2e.doctor's queue has exactly one clean, today-dated CHECKED_IN walk-in
    for e2e.patient -> ready for "Call Next Patient" -> "Complete Visit".
  - e2e.patient has at least one ISSUED (unpaid), one PARTIALLY_PAID, and one
    PAID invoice -> ready for the secretary's "Record Payment" modal, the
    patient's /patient/invoices view, and the manager's /manager/billing KPIs
    without needing the doctor step at all.
  - e2e.patient2 is left with zero invoices, for the isolation/empty-state check.
"""
from datetime import timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.appointments import services as appt_services
from apps.appointments.models import Appointment
from apps.billing import services as billing_services
from apps.billing.models import Invoice, InvoiceItem, ServiceItem
from apps.core.enums import (
    AppointmentStatus,
    InvoiceStatus,
    PaymentMethod,
    RoleChoices,
    ServiceItemType,
)
from apps.doctors.models import DoctorProfile
from apps.users.models import User

PASSWORD = "E2eTest123!"
SEED_TAG = "[e2e-billing-seed]"

ACTIVE_STATUSES = [
    AppointmentStatus.CONFIRMED,
    AppointmentStatus.CHECKED_IN,
    AppointmentStatus.IN_PROGRESS,
]


class Command(BaseCommand):
    help = "Seed Phase 12 billing fixtures onto the e2e.* accounts for manual/browser testing."

    @transaction.atomic
    def handle(self, *args, **options):
        patient_user = self._user("e2e.patient@test.dev", "Omar", "Hassan", RoleChoices.PATIENT)
        self._user("e2e.patient2@test.dev", "Nour", "Salem", RoleChoices.PATIENT)
        doctor_user = self._user("e2e.doctor@test.dev", "Mona", "Adly", RoleChoices.DOCTOR)
        secretary_user = self._user("e2e.secretary@test.dev", "Sara", "Desk", RoleChoices.SECRETARY)
        self._user("e2e.manager@test.dev", "Big", "Boss", RoleChoices.MANAGER)

        doctor_profile, _ = DoctorProfile.objects.get_or_create(
            user=doctor_user, defaults={"license_number": f"LIC-E2E-{doctor_user.pk}"}
        )
        patient_profile = patient_user.patient_profile

        self._clean_stale_queue(doctor_profile)
        self._ensure_queued_walk_in(patient_profile, doctor_profile, secretary_user)

        for status in (InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.PAID):
            self._ensure_invoice_bucket(patient_user, doctor_user, secretary_user, status)

        self._report()

    # --- accounts -----------------------------------------------------
    def _user(self, email, first, last, role):
        user, created = User.objects.get_or_create(
            email=email, defaults={"first_name": first, "last_name": last, "role": role},
        )
        if created:
            user.set_password(PASSWORD)
            user.save()
        return user

    # --- doctor queue ---------------------------------------------------
    def _clean_stale_queue(self, doctor_profile):
        """Cancel abandoned dry-run visits from earlier verification sessions
        (started but never completed) so the queue starts from a clean,
        deterministic state instead of surfacing a days-old "current" patient."""
        today = timezone.localdate()
        stale = Appointment.objects.filter(
            doctor=doctor_profile, status__in=ACTIVE_STATUSES,
            scheduled_start__date__lt=today,
        )
        count = stale.count()
        for appt in stale:
            appt_services.cancel_appointment(
                appt, cancelled_by=None, reason=f"{SEED_TAG} stale dry-run cleanup"
            )
        if count:
            self.stdout.write(f"  queue: cancelled {count} stale dry-run visit(s) from earlier sessions")

    def _ensure_queued_walk_in(self, patient_profile, doctor_profile, secretary_user):
        already_waiting = Appointment.objects.filter(
            doctor=doctor_profile, patient=patient_profile, status__in=ACTIVE_STATUSES,
        ).exists()
        if already_waiting:
            self.stdout.write("  queue: e2e.patient is already waiting/in-progress, left as-is")
            return
        appt_services.create_walk_in(
            patient=patient_profile, doctor=doctor_profile,
            reason=f"{SEED_TAG} ready for Complete Visit", created_by=secretary_user,
        )
        self.stdout.write(self.style.SUCCESS(
            "  queue: created a fresh CHECKED_IN walk-in for e2e.patient in e2e.doctor's queue"
        ))

    # --- invoices ---------------------------------------------------------
    def _ensure_invoice_bucket(self, patient_user, doctor_user, secretary_user, status):
        exists = Invoice.objects.filter(
            patient=patient_user, notes__icontains=SEED_TAG, status=status
        ).exists()
        if exists:
            self.stdout.write(f"  invoice[{status}]: already have one, left as-is")
            return

        catalog_item = (
            ServiceItem.objects.filter(item_type=ServiceItemType.CONSULTATION, is_active=True)
            .order_by("id").first()
        )
        price = catalog_item.default_price if catalog_item else Decimal("50.00")
        today = timezone.localdate()

        invoice = Invoice.objects.create(
            patient=patient_user, doctor=doctor_user,
            due_date=today + timedelta(days=7), status=InvoiceStatus.ISSUED,
            notes=f"{SEED_TAG} target={status}",
        )
        InvoiceItem.objects.create(
            invoice=invoice,
            description=catalog_item.name if catalog_item else "General Consultation",
            service_item=catalog_item, quantity=1, unit_price=price,
        )
        invoice.recalculate_totals()

        if status == InvoiceStatus.PARTIALLY_PAID:
            billing_services.record_payment(
                invoice=invoice, amount=(invoice.total / 2), payment_method=PaymentMethod.CASH,
                received_by=secretary_user,
            )
        elif status == InvoiceStatus.PAID:
            billing_services.record_payment(
                invoice=invoice, amount=invoice.total, payment_method=PaymentMethod.CARD,
                received_by=secretary_user,
            )
        invoice.refresh_from_db()
        self.stdout.write(self.style.SUCCESS(
            f"  invoice[{status}]: created {invoice.number} (total {invoice.total})"
        ))

    def _report(self):
        self.stdout.write(self.style.SUCCESS("\nReady. Log in at http://localhost:5173 (password E2eTest123!):"))
        self.stdout.write("  e2e.doctor@test.dev     -> /doctor/queue      : Call Next Patient -> Complete Visit -> billing popup")
        self.stdout.write("  e2e.secretary@test.dev  -> /secretary/billing : Record Payment on the ISSUED invoice (try overpaying too)")
        self.stdout.write("  e2e.patient@test.dev    -> /patient/invoices  : sees ISSUED + PARTIALLY_PAID + PAID invoices")
        self.stdout.write("  e2e.patient2@test.dev   -> /patient/invoices  : sees none (isolation) ; /secretary/billing -> 403")
        self.stdout.write("  e2e.manager@test.dev    -> /manager/billing   : KPIs + revenue table")
