"""One-shot fixture for manually verifying Phase 14 (Clinical Procedures Module)
without walking through registration -> booking -> check-in -> queue every time.

    python manage.py seed_procedures_e2e

Re-running is safe: it only tops up whatever a prior test round consumed (e.g.
a queued walk-in that got called) and never touches other data. Uses
e2e.patient3 (not e2e.patient / e2e.patient2) for its queue slot so it never
collides with the billing fixture's walk-in (e2e.patient) or the referrals
fixture's walk-in (e2e.patient2).

What it guarantees on the e2e.* accounts (see .claude/skills/verify/SKILL.md
for the passwords/routes):
  - The master ProcedureTemplate catalog is seeded (Wound Suturing, Minor Skin
    Biopsy, Intradermal/IM Injection, Dressing Change, General Procedure).
  - e2e.doctor's queue has exactly one clean, today-dated CHECKED_IN walk-in
    for e2e.patient3 -> ready for "Call Next Patient" -> open the encounter ->
    "Add Procedure" (try it once with a template, once with the custom/
    free-text option), which also puts e2e.patient3 in e2e.doctor's
    "my patients" list for the PatientRecordPage dropdown immediately.
  - e2e.patient3 already has one ClinicalProcedure in each lifecycle bucket,
    all performed by e2e.doctor, so every screen has real rows to act on
    immediately without manually driving create -> start -> complete/cancel
    for each state first:
      * SCHEDULED   (from the "Wound Suturing" template)   -> test Cancel
      * IN_PROGRESS (from "Minor Skin Biopsy", checklist half-checked)
        -> test toggling the rest, the required-post-notes guard, Complete
      * COMPLETED   (from "Dressing Change", full checklist + notes)
        -> test that the terminal record is fully locked (no action buttons,
        disabled fields)
      * CANCELLED   (custom "Ear Cleaning", no template)
        -> test that the cancellation reason renders and no action buttons
        appear
"""
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.appointments import services as appt_services
from apps.appointments.models import Appointment
from apps.core.enums import AppointmentStatus, ProcedureStatus, RoleChoices
from apps.doctors.models import DoctorProfile
from apps.procedures.models import ClinicalProcedure, ProcedureTemplate
from apps.procedures.services import (
    cancel_procedure,
    complete_procedure,
    seed_procedure_templates,
    start_procedure,
)
from apps.users.models import User

PASSWORD = "E2eTest123!"
SEED_TAG = "[e2e-procedures-seed]"

ACTIVE_STATUSES = [
    AppointmentStatus.CONFIRMED,
    AppointmentStatus.CHECKED_IN,
    AppointmentStatus.IN_PROGRESS,
]


class Command(BaseCommand):
    help = "Seed Phase 14 clinical-procedures fixtures onto the e2e.* accounts for manual/browser testing."

    @transaction.atomic
    def handle(self, *args, **options):
        counts = seed_procedure_templates()
        self.stdout.write(
            f"  templates: {counts['created']} created, {counts['updated']} already present"
        )

        patient_user = self._user("e2e.patient3@test.dev", "Yara", "Fathy", RoleChoices.PATIENT)
        doctor_user = self._user("e2e.doctor@test.dev", "Mona", "Adly", RoleChoices.DOCTOR)
        secretary_user = self._user("e2e.secretary@test.dev", "Sara", "Desk", RoleChoices.SECRETARY)
        self._user("e2e.manager@test.dev", "Big", "Boss", RoleChoices.MANAGER)

        doctor_profile, _ = DoctorProfile.objects.get_or_create(
            user=doctor_user, defaults={"license_number": f"LIC-E2E-{doctor_user.pk}"}
        )
        patient_profile = patient_user.patient_profile

        self._clean_stale_queue(doctor_profile)
        self._ensure_queued_walk_in(patient_profile, doctor_profile, secretary_user)

        templates = {
            t.name: t
            for t in ProcedureTemplate.objects.filter(
                name__in=["Wound Suturing", "Minor Skin Biopsy", "Dressing Change"]
            )
        }
        self._ensure_scheduled(patient_profile, doctor_profile, templates["Wound Suturing"])
        self._ensure_in_progress(patient_profile, doctor_profile, templates["Minor Skin Biopsy"])
        self._ensure_completed(patient_profile, doctor_profile, templates["Dressing Change"])
        self._ensure_cancelled(patient_profile, doctor_profile)

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
            self.stdout.write("  queue: e2e.patient3 is already waiting/in-progress, left as-is")
            return
        appt_services.create_walk_in(
            patient=patient_profile, doctor=doctor_profile,
            reason=f"{SEED_TAG} ready for Add Procedure", created_by=secretary_user,
        )
        self.stdout.write(self.style.SUCCESS(
            "  queue: created a fresh CHECKED_IN walk-in for e2e.patient3 in e2e.doctor's queue"
        ))

    # --- procedure buckets ----------------------------------------------
    def _tag(self, key):
        return f"{SEED_TAG} bucket={key}"

    def _bucket_exists(self, patient_profile, key, status):
        # Match on status too, not just the tag: if a prior test round moved
        # the tagged record out of this bucket's status (e.g. cancelled the
        # SCHEDULED one), top up with a fresh one rather than reporting it as
        # already present.
        return ClinicalProcedure.objects.filter(
            patient=patient_profile, pre_procedure_notes__icontains=self._tag(key), status=status
        ).exists()

    def _ensure_scheduled(self, patient_profile, doctor_profile, template):
        key = "scheduled"
        if self._bucket_exists(patient_profile, key, ProcedureStatus.SCHEDULED):
            self.stdout.write(f"  procedure[{key}]: already have one, left as-is")
            return
        ClinicalProcedure.objects.create(
            patient=patient_profile, doctor=doctor_profile, template=template,
            pre_procedure_notes=f"{self._tag(key)} Patient consented, no known allergies.",
        )
        self.stdout.write(self.style.SUCCESS(f"  procedure[{key}]: created ({template.name}), status=SCHEDULED"))

    def _ensure_in_progress(self, patient_profile, doctor_profile, template):
        key = "in-progress"
        if self._bucket_exists(patient_profile, key, ProcedureStatus.IN_PROGRESS):
            self.stdout.write(f"  procedure[{key}]: already have one, left as-is")
            return
        procedure = ClinicalProcedure.objects.create(
            patient=patient_profile, doctor=doctor_profile, template=template,
            pre_procedure_notes=f"{self._tag(key)} Patient consented, site marked.",
        )
        procedure = start_procedure(procedure)
        half = len(procedure.checklist_state) // 2 or 1
        for step in procedure.checklist_state[:half]:
            step["completed"] = True
        procedure.save(update_fields=["checklist_state", "updated_at"])
        self.stdout.write(self.style.SUCCESS(
            f"  procedure[{key}]: created ({template.name}), status=IN_PROGRESS, "
            f"{half}/{len(procedure.checklist_state)} checklist steps already done"
        ))

    def _ensure_completed(self, patient_profile, doctor_profile, template):
        key = "completed"
        if self._bucket_exists(patient_profile, key, ProcedureStatus.COMPLETED):
            self.stdout.write(f"  procedure[{key}]: already have one, left as-is")
            return
        procedure = ClinicalProcedure.objects.create(
            patient=patient_profile, doctor=doctor_profile, template=template,
            pre_procedure_notes=f"{self._tag(key)} Patient consented.",
        )
        procedure = start_procedure(procedure)
        for step in procedure.checklist_state:
            step["completed"] = True
        procedure.save(update_fields=["checklist_state", "updated_at"])
        complete_procedure(
            procedure,
            post_procedure_notes="Dressing changed cleanly, wound looks healthy.",
            complications="",
        )
        self.stdout.write(self.style.SUCCESS(f"  procedure[{key}]: created ({template.name}), status=COMPLETED"))

    def _ensure_cancelled(self, patient_profile, doctor_profile):
        key = "cancelled"
        if self._bucket_exists(patient_profile, key, ProcedureStatus.CANCELLED):
            self.stdout.write(f"  procedure[{key}]: already have one, left as-is")
            return
        procedure = ClinicalProcedure.objects.create(
            patient=patient_profile, doctor=doctor_profile,
            procedure_name="Ear Cleaning", procedure_name_ar="تنظيف الأذن",
            pre_procedure_notes=f"{self._tag(key)} Free-text procedure, no template.",
        )
        cancel_procedure(procedure, "Patient rescheduled to next week", doctor_profile.user)
        self.stdout.write(self.style.SUCCESS("  procedure[cancelled]: created (custom, no template), status=CANCELLED"))

    def _report(self):
        self.stdout.write(self.style.SUCCESS("\nReady. Log in at http://localhost:5173 (password E2eTest123!):"))
        self.stdout.write(
            "  e2e.doctor@test.dev    -> /doctor/queue : \"Call Next Patient\" (e2e.patient3) -> open the "
            "encounter -> \"Add Procedure\", try it twice (once with a template, once with \"Custom / "
            "free-text procedure\")"
        )
        self.stdout.write(
            "  e2e.doctor@test.dev    -> same encounter -> \"Linked procedures\" -> click the row you just "
            "created -> \"Start Procedure\" -> tick checklist steps -> fill \"Post-procedure notes\" -> "
            "\"Complete Procedure\""
        )
        self.stdout.write(
            "  e2e.doctor@test.dev    -> /doctor/patients -> select \"Yara Fathy\" -> \"Procedures\" section: "
            "4 seeded rows ready to act on:"
        )
        self.stdout.write(
            "      SCHEDULED   -> open -> \"Cancel Procedure\" -> type a reason (>=3 chars) -> "
            "\"Confirm Cancellation\""
        )
        self.stdout.write(
            "      IN_PROGRESS -> open -> tick the remaining checklist steps -> \"Complete Procedure\" stays "
            "disabled until post-notes is filled -> fill it -> Complete"
        )
        self.stdout.write(
            "      COMPLETED   -> open -> confirm it's fully read-only (checklist/notes disabled, no action "
            "buttons)"
        )
        self.stdout.write(
            "      CANCELLED   -> open -> confirm the cancellation reason is shown and there are no action "
            "buttons"
        )
        self.stdout.write(
            "  e2e.manager@test.dev   -> /manager/audit -> search a procedure name (e.g. \"Biopsy\") or just "
            "browse unfiltered, newest-first -> CREATE + UPDATE entries for everything you just did"
        )
        self.stdout.write(
            "  e2e.patient3@test.dev  -> log in -> notification bell shows \"Procedure scheduled\" / "
            "\"completed\" / \"cancelled\" entries"
        )
        self.stdout.write(self.style.WARNING(
            "  Note: no frontend page shows procedures to the PATIENT or MANAGER role directly (matches the "
            "Phase 14 spec: doctor-only UI). Their read/oversight access is API-level only and is covered by "
            "Backend/tests/test_procedures.py, not by browser clicking."
        ))
