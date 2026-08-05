"""One-shot fixture for manually verifying Phase 1 (Core) without walking
through registration -> booking -> confirm -> check-in -> queue every time.

    python manage.py seed_phase1_e2e

Re-running is safe: it only tops up whatever a prior test round consumed
(e.g. a PENDING appointment that got confirmed) and never touches other
phases' fixtures. Uses e2e.patient5 .. e2e.patient10 (not e2e.patient /
e2e.patient2 / e2e.patient3 / e2e.patient4, already claimed by the billing /
referrals / procedures / radiology fixtures) so it never collides with them,
even though several of them share the same e2e.doctor queue.

What it guarantees on the e2e.* accounts (see .claude/skills/verify/SKILL.md
for the shared password/routes):
  - e2e.patient5  -> PENDING appointment today   -> secretary desk: Confirm
  - e2e.patient6  -> PENDING appointment today   -> secretary desk: Cancel
  - e2e.patient7  -> CONFIRMED appointment today -> secretary Queue Board: Check in
  - e2e.patient8  -> CHECKED_IN appointment today -> doctor queue: "Call Next Patient"
  - e2e.patient9  -> IN_PROGRESS appointment today (shows as "Current")
                     -> doctor queue: "Complete Visit"
  - e2e.patient10 -> already COMPLETED today (via the real complete_appointment
                     service, so billing + the DoctorPatient link + audit log
                     all have a genuine history entry) -> shows in "Previous"
                     panel, the public kiosk, and the manager audit log
                     immediately, with nothing left to click.
"""
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.appointments import services as appt_services
from apps.appointments.models import Appointment
from apps.core.enums import AppointmentStatus, AppointmentType, RoleChoices
from apps.doctors.models import DoctorProfile
from apps.users.models import User

PASSWORD = "E2eTest123!"
SEED_TAG = "[e2e-phase1-seed]"

ACTIVE_STATUSES = [
    AppointmentStatus.PENDING,
    AppointmentStatus.CONFIRMED,
    AppointmentStatus.CHECKED_IN,
    AppointmentStatus.IN_PROGRESS,
]

# (slot, email, first, last, status, scheduled_start offset in minutes from now).
# Offsets fix the doctor queue's "Next" ordering (earliest scheduled_start
# wins among CONFIRMED/CHECKED_IN waiters) so Tamer (already checked in) is
# always called before Laila (still needs a front-desk check-in first),
# regardless of the order the rows happen to be created in.
PATIENTS = [
    ("pending-confirm", "e2e.patient5@test.dev", "Nadia", "Confirm", AppointmentStatus.PENDING, 30),
    ("pending-cancel", "e2e.patient6@test.dev", "Omar", "Cancel", AppointmentStatus.PENDING, 40),
    ("confirmed-checkin", "e2e.patient7@test.dev", "Laila", "Checkin", AppointmentStatus.CONFIRMED, -5),
    ("checked-in-start", "e2e.patient8@test.dev", "Tamer", "Start", AppointmentStatus.CHECKED_IN, -10),
    ("in-progress-complete", "e2e.patient9@test.dev", "Rania", "Complete", AppointmentStatus.IN_PROGRESS, -20),
    ("completed-history", "e2e.patient10@test.dev", "Hassan", "History", AppointmentStatus.COMPLETED, 0),
]


class Command(BaseCommand):
    help = "Seed Phase 1 (Core) fixtures onto the e2e.* accounts for manual/browser testing."

    @transaction.atomic
    def handle(self, *args, **options):
        doctor_user = self._user("e2e.doctor@test.dev", "Mona", "Adly", RoleChoices.DOCTOR)
        secretary_user = self._user("e2e.secretary@test.dev", "Sara", "Desk", RoleChoices.SECRETARY)
        self._user("e2e.manager@test.dev", "Big", "Boss", RoleChoices.MANAGER)
        doctor_profile, _ = DoctorProfile.objects.get_or_create(
            user=doctor_user, defaults={"license_number": f"LIC-E2E-{doctor_user.pk}"}
        )

        patients = {
            key: self._user(email, first, last, RoleChoices.PATIENT)
            for key, email, first, last, _status, _offset in PATIENTS
        }

        self._clean_stale_queue(doctor_profile)

        for key, _email, _first, _last, status, offset in PATIENTS:
            patient_profile = patients[key].patient_profile
            if status == AppointmentStatus.COMPLETED:
                self._ensure_completed(key, patient_profile, doctor_profile, secretary_user)
            else:
                self._ensure_bucket(key, patient_profile, doctor_profile, status, offset)

        self._report(doctor_profile)

    # --- accounts ---------------------------------------------------------
    def _user(self, email, first, last, role):
        user, created = User.objects.get_or_create(
            email=email, defaults={"first_name": first, "last_name": last, "role": role},
        )
        if created:
            user.set_password(PASSWORD)
            user.save()
        return user

    # --- queue hygiene ------------------------------------------------------
    def _clean_stale_queue(self, doctor_profile):
        """Cancel abandoned dry-run visits from earlier verification sessions
        (started but never completed) so the queue -- and specifically the
        "Next" ordering, which picks the earliest scheduled_start among all
        waiting appointments -- starts deterministic instead of a days-old
        entry (possibly from a sibling phase's e2e fixture, since e2e.doctor's
        queue is shared across seed_{procedures,radiology,referrals}_e2e too)
        winning the slot. Scoped to date < today only, matching the same
        doctor-wide convention those sibling scripts already use, so it only
        ever removes abandoned prior-day dry runs, never same-day fixtures."""
        today = timezone.localdate()
        stale = Appointment.objects.filter(
            doctor=doctor_profile,
            status__in=ACTIVE_STATUSES, scheduled_start__date__lt=today,
        )
        count = stale.count()
        for appt in stale:
            appt_services.cancel_appointment(
                appt, cancelled_by=None, reason=f"{SEED_TAG} stale dry-run cleanup"
            )
        if count:
            self.stdout.write(f"  queue: cancelled {count} stale dry-run visit(s) from earlier sessions")

    # --- buckets ------------------------------------------------------------
    def _tag(self, key):
        return f"{SEED_TAG} bucket={key}"

    def _bucket_exists(self, patient_profile, doctor_profile, key, status):
        # Match on status too, not just the tag: if a prior test round moved
        # the tagged appointment out of this bucket's status (e.g. confirmed
        # the PENDING one), top up with a fresh one rather than reporting it
        # as already present.
        return Appointment.objects.filter(
            patient=patient_profile, doctor=doctor_profile,
            reason__icontains=self._tag(key), status=status,
        ).exists()

    def _ensure_bucket(self, key, patient_profile, doctor_profile, status, offset_minutes):
        if self._bucket_exists(patient_profile, doctor_profile, key, status):
            self.stdout.write(f"  appointment[{key}]: already have one in {status}, left as-is")
            return
        now = timezone.now()
        scheduled_start = now + timezone.timedelta(minutes=offset_minutes)
        appt = Appointment.objects.create(
            patient=patient_profile, doctor=doctor_profile,
            scheduled_start=scheduled_start, scheduled_end=scheduled_start,
            status=status, appointment_type=AppointmentType.SCHEDULED,
            reason=f"{self._tag(key)} Routine checkup.",
        )
        if status in (AppointmentStatus.CHECKED_IN, AppointmentStatus.IN_PROGRESS):
            appt.checked_in_at = now
        if status == AppointmentStatus.IN_PROGRESS:
            appt.started_at = now
        appt.save()
        self.stdout.write(self.style.SUCCESS(f"  appointment[{key}]: created, status={status}"))

    def _ensure_completed(self, key, patient_profile, doctor_profile, secretary_user):
        if self._bucket_exists(patient_profile, doctor_profile, key, AppointmentStatus.COMPLETED):
            self.stdout.write(f"  appointment[{key}]: already have one COMPLETED, left as-is")
            return
        # Go through the real service calls so billing / the DoctorPatient
        # link / the audit trail all get a genuine history entry, not a
        # hand-faked row.
        appt = appt_services.create_walk_in(
            patient=patient_profile, doctor=doctor_profile,
            reason=f"{self._tag(key)} Routine checkup.", created_by=secretary_user,
        )
        appt_services.complete_appointment(appt)
        self.stdout.write(self.style.SUCCESS(f"  appointment[{key}]: created and completed via the real service"))

    def _report(self, doctor_profile):
        self.stdout.write(self.style.SUCCESS("\nReady. Log in at http://localhost:5173 (password E2eTest123!):"))
        self.stdout.write(
            "  e2e.secretary@test.dev -> /secretary/desk (default PENDING filter): "
            "\"Nadia Confirm\" -> Confirm, \"Omar Cancel\" -> Cancel"
        )
        self.stdout.write(
            "  e2e.secretary@test.dev -> /secretary/queue -> select \"Mona Adly\" -> "
            "\"Laila Checkin\" -> Check in"
        )
        self.stdout.write(
            "  e2e.secretary@test.dev -> /secretary/doctors -> edit \"Mona Adly\"'s profile "
            "(bio / years experience / etc.) -> Save"
        )
        self.stdout.write(
            "  e2e.doctor@test.dev    -> /doctor/queue : Current=\"Rania Complete\" -> "
            "\"Complete Visit\"; Next=\"Tamer Start\" (and \"Laila Checkin\" once checked in) "
            "-> \"Call Next Patient\" -> \"Complete Visit\", repeat until the queue is empty"
        )
        self.stdout.write(
            f"  (no login)             -> http://localhost:5173/kiosk/{doctor_profile.id} "
            "-> shows the live waiting room + now-serving"
        )
        self.stdout.write(
            "  e2e.manager@test.dev   -> /manager/audit -> search \"Complete\", \"Checkin\", "
            "etc. or just browse unfiltered, newest-first -> every action above shows up"
        )
        self.stdout.write(self.style.WARNING(
            "  Note: registration, login/logout, and forgot/reset-password can't be "
            "pre-seeded (each needs a brand-new email) -- register a fresh throwaway "
            "account for those, see the walkthrough."
        ))
