"""One-shot fixture for manually verifying the doctor Live Queue cleanup +
Follow-up "previous visit" context without walking through
registration -> booking -> check-in -> submit every time.

    python manage.py seed_queue_workflow_e2e

Re-running is safe: it only tops up whatever a prior round consumed and never
touches other seed commands' data -- uses its own dedicated e2e.patient5 /
e2e.patient6 accounts, deliberately distinct from the billing/referrals/
procedures/radiology seeds' e2e.patient / patient2 / patient3 / patient4.

What it guarantees on the e2e.* accounts (see .claude/skills/verify/SKILL.md
for the passwords/routes):
  - e2e.doctor's queue has a fresh CHECKED_IN walk-in for e2e.patient5, whose
    profile carries allergies/chronic conditions/current medications --
    ready to click "Open Clinical Encounter" / "See Patient" on the Live
    Queue (a single button now -- no No-show/Open-Record/Complete) and watch
    it auto-flip to IN_PROGRESS with no manual Start click, with the
    allergy/chronic/meds snapshot visible on the encounter page itself.
  - e2e.patient6 has one SUBMITTED origin encounter (diagnosis + treatment +
    a prescription) plus a CONFIRMED Follow-up appointment resulting from
    it -- opening its encounter shows the "Follow-up" badge and a "Previous
    Visit" sidebar card carrying that origin diagnosis/prescription forward.
"""
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.appointments import services as appt_services
from apps.appointments.models import Appointment
from apps.core.enums import AppointmentStatus, AppointmentType, RoleChoices
from apps.doctors.models import DoctorProfile
from apps.doctors.services import slot_generator
from apps.encounters import services as encounter_services
from apps.encounters.models import Diagnosis
from apps.medical_records.models import Prescription, PrescriptionItem

PASSWORD = "E2eTest123!"
SEED_TAG = "[e2e-queue-workflow-seed]"

ACTIVE_STATUSES = [
    AppointmentStatus.CONFIRMED,
    AppointmentStatus.CHECKED_IN,
    AppointmentStatus.IN_PROGRESS,
]


class Command(BaseCommand):
    help = "Seed a Live-Queue walk-in + a Follow-up-with-history fixture for manual/browser testing."

    @transaction.atomic
    def handle(self, *args, **options):
        doctor_user = self._user("e2e.doctor@test.dev", "Mona", "Adly", RoleChoices.DOCTOR)
        doctor_profile, _ = DoctorProfile.objects.get_or_create(
            user=doctor_user, defaults={"license_number": f"LIC-E2E-{doctor_user.pk}"}
        )
        secretary_user = self._user("e2e.secretary@test.dev", "Sara", "Desk", RoleChoices.SECRETARY)

        patient5_user = self._user("e2e.patient5@test.dev", "Layla", "Fahmy", RoleChoices.PATIENT)
        patient6_user = self._user("e2e.patient6@test.dev", "Karim", "Adel", RoleChoices.PATIENT)

        self._prep_patient5(patient5_user.patient_profile, doctor_profile, secretary_user)
        self._prep_patient6(patient6_user.patient_profile, doctor_profile)

        self._report()

    # --- accounts ---------------------------------------------------------
    def _user(self, email, first, last, role):
        """get_or_create alone isn't enough on this long-lived dev DB: these
        e2e.* emails can already exist from an earlier, unrelated test session
        under a different (often deliberately silly, e.g. "Cancel"/"Confirm")
        name, and `defaults=` is only applied on creation -- so a stale name
        would otherwise show up on screen even though this command "owns" the
        fixture data attached to the account. Force the name every run."""
        from apps.users.models import User

        user, created = User.objects.get_or_create(
            email=email, defaults={"first_name": first, "last_name": last, "role": role},
        )
        if created:
            user.set_password(PASSWORD)
            user.save()
        elif user.first_name != first or user.last_name != last:
            user.first_name = first
            user.last_name = last
            user.save(update_fields=["first_name", "last_name"])
        return user

    # --- e2e.patient5: plain walk-in for the Live Queue cleanup + auto-start check ---
    def _prep_patient5(self, patient_profile, doctor_profile, secretary_user):
        patient_profile.allergies_summary = "Penicillin, Aspirin"
        patient_profile.chronic_conditions = "Type 2 diabetes, Hypertension"
        patient_profile.current_medications = "Metformin 500mg, Lisinopril 10mg"
        patient_profile.save(update_fields=["allergies_summary", "chronic_conditions", "current_medications"])

        already_waiting = Appointment.objects.filter(
            doctor=doctor_profile, patient=patient_profile, status__in=ACTIVE_STATUSES,
        ).exists()
        if already_waiting:
            self.stdout.write("  patient5: already waiting/in-progress, left as-is")
            return
        appt_services.create_walk_in(
            patient=patient_profile, doctor=doctor_profile,
            reason=f"{SEED_TAG} routine check-up", created_by=secretary_user,
        )
        self.stdout.write(self.style.SUCCESS(
            "  patient5: created a fresh CHECKED_IN walk-in (allergies/chronic/meds set) in e2e.doctor's queue"
        ))

    # --- e2e.patient6: a submitted origin visit + a confirmed follow-up -----
    def _prep_patient6(self, patient_profile, doctor_profile):
        origin = Appointment.objects.filter(
            patient=patient_profile, doctor=doctor_profile, status=AppointmentStatus.COMPLETED,
        ).order_by("scheduled_start").first()

        if origin is None or not hasattr(origin, "encounter"):
            origin = self._create_submitted_origin_visit(patient_profile, doctor_profile)
            self.stdout.write(self.style.SUCCESS(
                "  patient6: created a SUBMITTED origin encounter (diagnosis + treatment + prescription)"
            ))
        else:
            self.stdout.write("  patient6: origin encounter already exists, left as-is")

        followup_active = Appointment.objects.filter(
            patient=patient_profile, doctor=doctor_profile,
            appointment_type=AppointmentType.FOLLOW_UP, status__in=ACTIVE_STATUSES,
        ).exists()
        if followup_active:
            self.stdout.write("  patient6: follow-up appointment already waiting, left as-is")
            return

        today = timezone.localdate()
        slot_generator.generate_slots_for_doctor(doctor_profile, today, today + timezone.timedelta(days=2))
        followup = appt_services.create_followup(origin_appointment=origin, recommended_date=today)
        resulting = appt_services.confirm_followup(followup)
        appt_services.confirm_appointment(resulting)
        self.stdout.write(self.style.SUCCESS(
            "  patient6: booked + confirmed a Follow-up appointment ready for e2e.doctor's queue"
        ))

    def _create_submitted_origin_visit(self, patient_profile, doctor_profile):
        origin = appt_services.create_walk_in(
            patient=patient_profile, doctor=doctor_profile,
            reason=f"{SEED_TAG} origin visit", created_by=None,
        )
        origin.status = AppointmentStatus.IN_PROGRESS
        origin.started_at = timezone.now()
        origin.save(update_fields=["status", "started_at", "updated_at"])

        diagnosis = Diagnosis.objects.first()
        if diagnosis is None:
            diagnosis = Diagnosis.objects.create(name="Seasonal allergy")

        draft = encounter_services.get_or_create_draft(appointment=origin, doctor=doctor_profile)
        draft.chief_complaint = "Persistent cough and sore throat"
        draft.diagnosis = diagnosis
        draft.diagnosis_notes = "Likely viral upper respiratory infection."
        draft.treatment_plan = "Rest, fluids, and follow up in 2 weeks if symptoms persist."
        draft.save(update_fields=["chief_complaint", "diagnosis", "diagnosis_notes", "treatment_plan"])

        prescription = Prescription.objects.create(
            patient=patient_profile, doctor=doctor_profile, appointment=origin, encounter=draft,
        )
        PrescriptionItem.objects.create(
            prescription=prescription, drug_name="Amoxicillin", dosage_strength="500mg",
            dosage="1 tablet", frequency="Three times a day", duration="7 days",
        )

        encounter_services.submit_encounter(draft)
        origin.refresh_from_db()
        return origin

    def _report(self):
        self.stdout.write(self.style.SUCCESS("\nReady. Log in at http://localhost:5173 (password E2eTest123!):"))
        self.stdout.write("  e2e.doctor@test.dev -> /doctor/queue")
        self.stdout.write("    Live Queue now has a single 'Open Clinical Encounter' / 'See Patient' button")
        self.stdout.write("    (No Show / Open Record / Complete Visit are gone).")
        self.stdout.write("    - Layla Fahmy (e2e.patient5): plain walk-in with allergies/chronic conditions/meds set.")
        self.stdout.write("      Click through it -> the queue flips to IN_PROGRESS with no manual Start, and the")
        self.stdout.write("      encounter page shows the reason + allergy banner + chronic conditions + meds.")
        self.stdout.write("    - Karim Adel (e2e.patient6): CONFIRMED Follow-up appointment with a prior SUBMITTED visit.")
        self.stdout.write("      Its 'Follow-up' badge + a 'Previous Visit' sidebar card (diagnosis/treatment/")
        self.stdout.write("      prescription from the origin visit) should appear on the encounter page.")
        self.stdout.write("    Both are also reachable directly (regardless of queue position) via /doctor/appointments.")
