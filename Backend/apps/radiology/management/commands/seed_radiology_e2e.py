"""One-shot fixture for manually verifying Phase 15 (Radiology Order Templates)
without walking through registration -> booking -> check-in -> queue every time.

    python manage.py seed_radiology_e2e

Re-running is safe: it only tops up whatever a prior test round consumed (e.g.
a queued walk-in that got called) and never touches other data. Uses
e2e.patient4 (not e2e.patient / e2e.patient2 / e2e.patient3) for its queue slot
so it never collides with the billing fixture's walk-in (e2e.patient), the
referrals fixture's walk-in (e2e.patient2), or the procedures fixture's
walk-in (e2e.patient3).

What it guarantees on the e2e.* accounts (see .claude/skills/verify/SKILL.md
for the passwords/routes):
  - The master RadiologyTemplate catalog is seeded (Chest X-Ray, Abdominal
    Ultrasound, Head CT, Knee MRI, PET-CT Whole Body, Other Imaging Study).
  - e2e.doctor's queue has exactly one clean, today-dated CHECKED_IN walk-in
    for e2e.patient4 -> ready for "Call Next Patient" -> open the encounter ->
    "Order Radiology Study" (try it once with a template, once with the
    custom/free-text option).
  - e2e.patient4 already has one RadiologyOrder in each lifecycle bucket, so
    every screen has real rows to act on immediately without manually driving
    create -> complete -> report/cancel for each state first:
      * ORDERED   (from the "Chest X-Ray" template)        -> test Cancel
      * COMPLETED (from "Abdominal Ultrasound", scan attached) -> test Report
      * REPORTED  (from "Head CT", findings + impression filled in)
        -> test that the terminal record is fully locked (no action buttons)
      * CANCELLED (custom "Wrist X-Ray", no template)
        -> test that the cancellation reason renders and no action buttons
        appear
"""
from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.appointments import services as appt_services
from apps.appointments.models import Appointment
from apps.core.enums import AppointmentStatus, RadiologyOrderStatus, RoleChoices
from apps.doctors.models import DoctorProfile
from apps.radiology.models import RadiologyOrder, RadiologyTemplate
from apps.radiology.services import (
    cancel_order,
    complete_order,
    report_order,
    seed_radiology_templates,
)
from apps.users.models import User

PASSWORD = "E2eTest123!"
SEED_TAG = "[e2e-radiology-seed]"

ACTIVE_STATUSES = [
    AppointmentStatus.CONFIRMED,
    AppointmentStatus.CHECKED_IN,
    AppointmentStatus.IN_PROGRESS,
]

# 1x1 transparent PNG — enough to satisfy the upload-extension validator.
_FAKE_PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01"
    b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


class Command(BaseCommand):
    help = "Seed Phase 15 radiology-order fixtures onto the e2e.* accounts for manual/browser testing."

    @transaction.atomic
    def handle(self, *args, **options):
        counts = seed_radiology_templates()
        self.stdout.write(
            f"  templates: {counts['created']} created, {counts['updated']} already present"
        )

        patient_user = self._user("e2e.patient4@test.dev", "Laila", "Younes", RoleChoices.PATIENT)
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
            for t in RadiologyTemplate.objects.filter(
                name__in=["Chest X-Ray", "Abdominal Ultrasound", "Head CT"]
            )
        }
        self._ensure_ordered(patient_profile, doctor_profile, templates["Chest X-Ray"])
        self._ensure_completed(patient_profile, doctor_profile, secretary_user, templates["Abdominal Ultrasound"])
        self._ensure_reported(patient_profile, doctor_profile, secretary_user, templates["Head CT"])
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
            self.stdout.write("  queue: e2e.patient4 is already waiting/in-progress, left as-is")
            return
        appt_services.create_walk_in(
            patient=patient_profile, doctor=doctor_profile,
            reason=f"{SEED_TAG} ready for Order Radiology Study", created_by=secretary_user,
        )
        self.stdout.write(self.style.SUCCESS(
            "  queue: created a fresh CHECKED_IN walk-in for e2e.patient4 in e2e.doctor's queue"
        ))

    # --- order buckets ----------------------------------------------
    def _tag(self, key):
        return f"{SEED_TAG} bucket={key}"

    def _bucket_exists(self, patient_profile, key, status):
        # Match on status too, not just the tag: if a prior test round moved
        # the tagged record out of this bucket's status (e.g. reported the
        # COMPLETED one), top up with a fresh one rather than reporting it as
        # already present.
        return RadiologyOrder.objects.filter(
            patient=patient_profile, clinical_reason__icontains=self._tag(key), status=status
        ).exists()

    def _fake_file(self, name):
        return ContentFile(_FAKE_PNG_BYTES, name=name)

    def _ensure_ordered(self, patient_profile, doctor_profile, template):
        key = "ordered"
        if self._bucket_exists(patient_profile, key, RadiologyOrderStatus.ORDERED):
            self.stdout.write(f"  order[{key}]: already have one, left as-is")
            return
        RadiologyOrder.objects.create(
            patient=patient_profile, doctor=doctor_profile, template=template,
            clinical_reason=f"{self._tag(key)} Persistent cough for 3 weeks.",
        )
        self.stdout.write(self.style.SUCCESS(f"  order[{key}]: created ({template.name}), status=ORDERED"))

    def _ensure_completed(self, patient_profile, doctor_profile, secretary_user, template):
        key = "completed"
        if self._bucket_exists(patient_profile, key, RadiologyOrderStatus.COMPLETED):
            self.stdout.write(f"  order[{key}]: already have one, left as-is")
            return
        order = RadiologyOrder.objects.create(
            patient=patient_profile, doctor=doctor_profile, template=template,
            clinical_reason=f"{self._tag(key)} Recurrent abdominal pain.",
        )
        complete_order(
            order, file=self._fake_file("abdominal_us.png"), uploaded_by=secretary_user,
            description="Abdominal ultrasound image set.",
        )
        self.stdout.write(self.style.SUCCESS(f"  order[{key}]: created ({template.name}), status=COMPLETED"))

    def _ensure_reported(self, patient_profile, doctor_profile, secretary_user, template):
        key = "reported"
        if self._bucket_exists(patient_profile, key, RadiologyOrderStatus.REPORTED):
            self.stdout.write(f"  order[{key}]: already have one, left as-is")
            return
        order = RadiologyOrder.objects.create(
            patient=patient_profile, doctor=doctor_profile, template=template,
            clinical_reason=f"{self._tag(key)} Chronic headaches, rule out structural cause.",
        )
        complete_order(
            order, file=self._fake_file("head_ct.png"), uploaded_by=secretary_user,
            description="Head CT image set.",
        )
        report_order(
            order,
            findings="No acute intracranial abnormality. Ventricles and sulci are normal for age.",
            impression="Unremarkable head CT.",
        )
        self.stdout.write(self.style.SUCCESS(f"  order[{key}]: created ({template.name}), status=REPORTED"))

    def _ensure_cancelled(self, patient_profile, doctor_profile):
        key = "cancelled"
        if self._bucket_exists(patient_profile, key, RadiologyOrderStatus.CANCELLED):
            self.stdout.write(f"  order[{key}]: already have one, left as-is")
            return
        order = RadiologyOrder.objects.create(
            patient=patient_profile, doctor=doctor_profile,
            study_name="Wrist X-Ray", study_name_ar="أشعة سينية على الرسغ",
            clinical_reason=f"{self._tag(key)} Free-text order, no template.",
        )
        cancel_order(order, "Patient rescheduled to next week", doctor_profile.user)
        self.stdout.write(self.style.SUCCESS("  order[cancelled]: created (custom, no template), status=CANCELLED"))

    def _report(self):
        self.stdout.write(self.style.SUCCESS("\nReady. Log in at http://localhost:5173 (password E2eTest123!):"))
        self.stdout.write(
            "  e2e.doctor@test.dev    -> /doctor/queue : \"Call Next Patient\" (e2e.patient4) -> open the "
            "encounter -> \"Order Radiology Study\", try it twice (once with a template, once with "
            "\"Custom / free-text study\")"
        )
        self.stdout.write(
            "  e2e.doctor@test.dev    -> /doctor/patients -> select \"Laila Younes\" -> \"Radiology\" section: "
            "4 seeded rows ready to act on:"
        )
        self.stdout.write(
            "      ORDERED   -> open -> \"Cancel Order\" -> type a reason (>=3 chars) -> \"Confirm Cancellation\""
        )
        self.stdout.write(
            "      COMPLETED -> open -> \"Report\" -> fill findings + impression -> submit -> status becomes REPORTED"
        )
        self.stdout.write(
            "      REPORTED  -> open -> confirm it's fully read-only (no action buttons, findings/impression shown)"
        )
        self.stdout.write(
            "      CANCELLED -> open -> confirm the cancellation reason is shown and there are no action buttons"
        )
        self.stdout.write(
            "  e2e.secretary@test.dev -> /secretary/radiology (if wired up) or API -> POST "
            "/api/radiology-orders/{id}/complete/ with a file to complete the ORDERED row"
        )
        self.stdout.write(
            "  e2e.manager@test.dev   -> /manager/audit -> search a study name (e.g. \"Chest X-Ray\") or just "
            "browse unfiltered, newest-first -> CREATE + UPDATE entries for everything you just did"
        )
        self.stdout.write(
            "  e2e.patient4@test.dev  -> log in -> notification bell shows \"Radiology order created\" / "
            "\"completed\" / \"report available\" / \"cancelled\" entries"
        )
        self.stdout.write(self.style.WARNING(
            "  Note: no frontend page exists yet for this Phase 15 backend-only pass — verification here is "
            "API-level via Backend/tests/test_radiology.py, not browser clicking."
        ))
