"""One-shot fixture for manually verifying Phase 13 (Referrals + Complaints
Master) without walking through registration -> booking -> check-in -> queue
every time.

    python manage.py seed_referrals_e2e

Re-running is safe: it only tops up whatever a prior test round consumed
(e.g. a PENDING referral that got accepted) and never touches other data.
Uses e2e.patient2 (not e2e.patient1) for its queue slot so it never collides
with the billing fixture's (seed_billing_e2e) walk-in for e2e.patient.

What it guarantees on the e2e.* accounts (see .claude/skills/verify/SKILL.md
for the passwords/routes):
  - Chief-complaint master data is seeded (~80 bilingual entries), so the
    Encounter page's chief-complaint autocomplete has real matches to try.
  - e2e.doctor's queue has exactly one clean, today-dated CHECKED_IN walk-in
    for e2e.patient2 -> ready for "Call Next Patient" -> "Open Encounter" ->
    "Refer Patient" (a brand new referral, created live during the test).
  - e2e.doctor2 exists (Cardiology) as an eligible internal-referral target,
    both by specialty and by name.
  - e2e.patient2 already has one referral in each lifecycle state -- PENDING
    (specialty-wide, no named doctor), ACCEPTED, COMPLETED, CANCELLED, and a
    PENDING EXTERNAL one -- so every tab (doctor Sent/Received, patient
    referrals, secretary read-only list) has real rows to act on immediately,
    without needing to manually drive create -> accept -> complete -> cancel
    for each status first.
"""
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.appointments import services as appt_services
from apps.appointments.models import Appointment
from apps.core.enums import AppointmentStatus, ReferralType, RoleChoices
from apps.doctors.models import DoctorProfile, Specialty, SpecialtyCategory
from apps.encounters.models import Encounter, EncounterStatus
from apps.encounters.services import seed_complaints
from apps.referrals import services as referral_services
from apps.referrals.models import Referral
from apps.users.models import User

PASSWORD = "E2eTest123!"
SEED_TAG = "[e2e-referrals-seed]"

ACTIVE_STATUSES = [
    AppointmentStatus.CONFIRMED,
    AppointmentStatus.CHECKED_IN,
    AppointmentStatus.IN_PROGRESS,
]


class Command(BaseCommand):
    help = "Seed Phase 13 referrals + complaints-master fixtures onto the e2e.* accounts for manual/browser testing."

    @transaction.atomic
    def handle(self, *args, **options):
        counts = seed_complaints()
        self.stdout.write(
            f"  complaints master: {counts['created']} created, {counts['updated']} already present"
        )

        patient_user = self._user("e2e.patient2@test.dev", "Nour", "Salem", RoleChoices.PATIENT)
        doctor_user = self._user("e2e.doctor@test.dev", "Mona", "Adly", RoleChoices.DOCTOR)
        doctor2_user = self._user("e2e.doctor2@test.dev", "Karim", "Nabil", RoleChoices.DOCTOR)
        secretary_user = self._user("e2e.secretary@test.dev", "Sara", "Desk", RoleChoices.SECRETARY)
        self._user("e2e.manager@test.dev", "Big", "Boss", RoleChoices.MANAGER)

        doctor_profile, _ = DoctorProfile.objects.get_or_create(
            user=doctor_user, defaults={"license_number": f"LIC-E2E-{doctor_user.pk}"}
        )
        doctor2_profile, _ = DoctorProfile.objects.get_or_create(
            user=doctor2_user, defaults={"license_number": f"LIC-E2E-{doctor2_user.pk}"}
        )
        patient_profile = patient_user.patient_profile

        cardiology = self._specialty()
        doctor2_profile.specialties.add(cardiology)

        self._clean_stale_queue(doctor_profile)
        self._ensure_queued_walk_in(patient_profile, doctor_profile, secretary_user)

        self._ensure_referral_bucket(
            key="pending-specialty-wide", patient=patient_profile,
            referring_doctor=doctor_profile, target_doctor=None, specialty=cardiology,
            final_status="PENDING",
        )
        self._ensure_referral_bucket(
            key="accepted", patient=patient_profile,
            referring_doctor=doctor_profile, target_doctor=doctor2_profile, specialty=cardiology,
            final_status="ACCEPTED",
        )
        self._ensure_referral_bucket(
            key="completed", patient=patient_profile,
            referring_doctor=doctor_profile, target_doctor=doctor2_profile, specialty=cardiology,
            final_status="COMPLETED",
        )
        self._ensure_referral_bucket(
            key="cancelled", patient=patient_profile,
            referring_doctor=doctor_profile, target_doctor=doctor2_profile, specialty=cardiology,
            final_status="CANCELLED",
        )
        self._ensure_referral_bucket(
            key="external-pending", patient=patient_profile,
            referring_doctor=doctor_profile, target_doctor=None, specialty=None,
            final_status="PENDING", referral_type=ReferralType.EXTERNAL,
            external_facility_name="Nile Specialized Hospital",
        )

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

    def _specialty(self):
        category, _ = SpecialtyCategory.objects.get_or_create(
            name="Cardiovascular", defaults={"name_ar": "القلب والأوعية"}
        )
        specialty, _ = Specialty.objects.get_or_create(
            name="Cardiology", defaults={"name_ar": "أمراض القلب", "category": category}
        )
        return specialty

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
            self.stdout.write("  queue: e2e.patient2 is already waiting/in-progress, left as-is")
            return
        appt_services.create_walk_in(
            patient=patient_profile, doctor=doctor_profile,
            reason=f"{SEED_TAG} ready for Refer Patient", created_by=secretary_user,
        )
        self.stdout.write(self.style.SUCCESS(
            "  queue: created a fresh CHECKED_IN walk-in for e2e.patient2 in e2e.doctor's queue"
        ))

    # --- referrals ----------------------------------------------------------
    def _ensure_referral_bucket(
        self, *, key, patient, referring_doctor, target_doctor, specialty, final_status,
        referral_type=ReferralType.INTERNAL, external_facility_name="",
    ):
        tag = f"{SEED_TAG} bucket={key}"
        if Referral.objects.filter(notes__icontains=tag).exists():
            self.stdout.write(f"  referral[{key}]: already have one, left as-is")
            return

        encounter = Encounter.objects.create(
            patient=patient, doctor=referring_doctor, status=EncounterStatus.SUBMITTED,
            chief_complaint="Chest pain", chief_complaint_ar="ألم في الصدر",
        )
        referral = referral_services.create_referral(
            encounter=encounter, doctor=referring_doctor,
            referral_type=referral_type, specialty=specialty, target_doctor=target_doctor,
            external_facility_name=external_facility_name,
            reason=f"{SEED_TAG} sample referral ({key})", notes=tag,
        )

        if final_status in ("ACCEPTED", "COMPLETED"):
            referral = referral_services.accept_referral(referral, target_doctor)
        if final_status == "COMPLETED":
            referral = referral_services.complete_referral(referral, target_doctor)
        if final_status == "CANCELLED":
            referral = referral_services.cancel_referral(referral, referring_doctor.user)

        self.stdout.write(self.style.SUCCESS(f"  referral[{key}]: created, status={referral.status}"))

    def _report(self):
        self.stdout.write(self.style.SUCCESS("\nReady. Log in at http://localhost:5173 (password E2eTest123!):"))
        self.stdout.write("  e2e.doctor@test.dev     -> /doctor/queue     : Call Next Patient (e2e.patient2) -> Open Encounter -> \"Refer Patient\" (create a fresh one, internal or external)")
        self.stdout.write("  e2e.doctor@test.dev     -> /doctor/referrals : Sent tab -> see PENDING/ACCEPTED/COMPLETED/CANCELLED/EXTERNAL rows; try Cancel on a PENDING one")
        self.stdout.write("  e2e.doctor2@test.dev    -> /doctor/referrals : Received tab -> Accept the specialty-wide PENDING one, Complete the ACCEPTED one")
        self.stdout.write("  e2e.patient2@test.dev   -> /patient/referrals: sees all 5 referrals across every status")
        self.stdout.write("  e2e.secretary@test.dev  -> /secretary/referrals: read-only list (no reason/notes columns)")
