"""One-shot fixture for manually verifying two things without walking through
booking/confirming by hand:

  1. The Live Queue UTC-vs-local day-boundary fix (see AppointmentViewSet.
     my_queue/queue_position in apps/appointments/views.py) -- a CONFIRMED
     appointment scheduled at 2 AM today must still show up in today's queue.
  2. The notification dropdown (HeaderBell) -- compact layout, scrolling past
     ~10 items, and 12-hour AM/PM / ص-م timestamps.

    python manage.py seed_queue_testdata

Re-running is safe: it only tops up whatever a prior round consumed and never
touches other seed commands' data -- uses its own dedicated e2e.patient11-13
accounts, distinct from every other seed script's e2e.patient/patient2../
patient10 and encounters' patient5/patient6.
"""
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.appointments import services as appt_services
from apps.appointments.models import Appointment
from apps.core.enums import AppointmentStatus, NotificationVerb, RoleChoices
from apps.doctors.models import DoctorProfile
from apps.notifications.services import notify

PASSWORD = "E2eTest123!"
SEED_TAG = "[e2e-queue-testdata-seed]"

# 10 varied, plausible doctor-facing notifications spanning every HeaderBell
# category (confirmed/pending/feedback/record/neutral -- see categoryForVerb
# in Frontend/src/components/layout/HeaderBell.tsx) and a spread of ages, so
# the dropdown has enough rows to demonstrate scrolling/compact padding and a
# realistic mix of relative-time labels.
DOCTOR_NOTIFICATIONS = [
    (5, NotificationVerb.REFERRAL_CREATED, "New patient referral", "إحالة مريض جديدة",
     "Dr. Hany Aziz referred Mostafa Kamel to you.", "أحال إليك د. هاني عزيز المريض مصطفى كامل.", False),
    (18, NotificationVerb.LAB_RESULT_CRITICAL, "Critical lab result", "نتيجة تحليل حرجة",
     "Critical result for Nourhan Adel (LAB-2026-0142) needs review.", "نتيجة حرجة للمريضة نور هان عادل (LAB-2026-0142) تحتاج مراجعة.", False),
    (45, NotificationVerb.RADIOLOGY_ORDER_REPORTED, "Radiology report available", "تقرير أشعة متاح",
     "The radiology report for Youssef Tarek is ready.", "تقرير الأشعة الخاص بيوسف طارق جاهز.", False),
    (90, NotificationVerb.LAB_RESULT_AVAILABLE, "Lab result available", "نتيجة تحليل متاحة",
     "Results for Mona Farid (LAB-2026-0139) are ready.", "نتائج المريضة منى فريد (LAB-2026-0139) جاهزة.", True),
    (150, NotificationVerb.PROCEDURE_SCHEDULED, "Procedure scheduled", "تم جدولة إجراء",
     "A minor procedure was scheduled for Ahmed Samir.", "تم جدولة إجراء طبي بسيط لأحمد سمير.", True),
    (220, NotificationVerb.REFERRAL_ACCEPTED, "Referral accepted", "تم قبول الإحالة",
     "Dr. Lina Kassem accepted your referral for Heba Nasser.", "وافقت د. لينا قاسم على إحالتك للمريضة هبة ناصر.", True),
    (400, NotificationVerb.PROCEDURE_COMPLETED, "Procedure completed", "تم إتمام الإجراء",
     "The procedure for Karim Adel is complete.", "تم الانتهاء من الإجراء الطبي لكريم عادل.", True),
    (600, NotificationVerb.PATIENT_SCAN_UPLOADED, "Patient uploaded a scan", "قام المريض برفع صورة أشعة",
     "Layla Fahmy uploaded a new X-Ray scan.", "قامت ليلى فهمي برفع صورة أشعة سينية جديدة.", True),
    (900, NotificationVerb.RADIOLOGY_ORDER_CREATED, "Radiology order created", "تم إنشاء طلب أشعة",
     "A new radiology order was created for Sara Emad.", "تم إنشاء طلب أشعة جديد للمريضة سارة عماد.", True),
    (1440, NotificationVerb.REFERRAL_COMPLETED, "Referral completed", "تم إتمام الإحالة",
     "Dr. Omar Saad completed your referral for Hassan Zaki.", "أتم د. عمر سعد إحالتك للمريض حسن زكي.", True),
]


class Command(BaseCommand):
    help = (
        "Seed today's CONFIRMED/CHECKED_IN appointments (incl. an early-morning "
        "one) plus varied notifications, for manually verifying the Live Queue "
        "timezone fix and the notification dropdown."
    )

    @transaction.atomic
    def handle(self, *args, **options):
        doctor_user = self._user("e2e.doctor@test.dev", "Mona", "Adly", RoleChoices.DOCTOR)
        doctor_profile, _ = DoctorProfile.objects.get_or_create(
            user=doctor_user, defaults={"license_number": f"LIC-E2E-{doctor_user.pk}"}
        )
        secretary_user = self._user("e2e.secretary@test.dev", "Sara", "Desk", RoleChoices.SECRETARY)

        elaria = self._user("e2e.patient11@test.dev", "Elaria", "Ezzat", RoleChoices.PATIENT)
        omar = self._user("e2e.patient12@test.dev", "Omar", "Nabil", RoleChoices.PATIENT)
        salma = self._user("e2e.patient13@test.dev", "Salma", "Youssef", RoleChoices.PATIENT)

        self._seed_early_morning_confirmed(elaria.patient_profile, doctor_profile)
        self._seed_current_time_confirmed(omar.patient_profile, doctor_profile)
        self._seed_arrived(salma.patient_profile, doctor_profile, secretary_user)
        self._seed_doctor_notifications(doctor_user)

        self._report()

    # --- accounts ---------------------------------------------------------
    def _user(self, email, first, last, role):
        """get_or_create alone isn't enough on this long-lived dev DB: these
        e2e.* emails can already exist from an earlier, unrelated test session
        under a different name, and `defaults=` is only applied on creation --
        force the name every run (see seed_queue_workflow_e2e for precedent)."""
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

    # --- e2e.patient11 (Elaria Ezzat): the exact reported repro case --------
    def _seed_early_morning_confirmed(self, patient_profile, doctor_profile):
        today = timezone.localdate()
        now = timezone.now()
        already = Appointment.objects.filter(
            doctor=doctor_profile, patient=patient_profile,
            scheduled_start__date=today, status=AppointmentStatus.CONFIRMED,
        ).exists()
        if already:
            self.stdout.write("  Elaria Ezzat: already has a CONFIRMED early-morning appointment today, left as-is")
            return
        if timezone.localtime(now).hour < 4:
            # It's genuinely early morning right now -- use the literal 2 AM
            # repro time from the bug report.
            start = timezone.make_aware(
                timezone.datetime.combine(today, timezone.datetime.min.time()) + timedelta(hours=2)
            )
        else:
            # A fixed "today 2 AM" would already be outside the no-show grace
            # window (mark_overdue_no_shows auto-flips CONFIRMED -> NO_SHOW
            # ~NO_SHOW_GRACE_MINUTES after scheduled_end) by the time anyone
            # actually looks at the queue, so it'd never survive to be
            # manually verified. Use a moment ago instead -- this still
            # exercises the exact same my_queue/queue_position code path;
            # the specific UTC-vs-local day-boundary scenario is covered
            # deterministically (via a mocked clock) by
            # tests/test_live_queue_timezone.py regardless of wall-clock time.
            start = now - timedelta(minutes=2)
        appt = Appointment.objects.create(
            patient=patient_profile, doctor=doctor_profile,
            scheduled_start=start,
            scheduled_end=start + timedelta(minutes=doctor_profile.avg_appointment_duration or 30),
            status=AppointmentStatus.PENDING, reason=f"{SEED_TAG} routine check-up",
        )
        appt_services.confirm_appointment(appt)
        self.stdout.write(self.style.SUCCESS(
            "  Elaria Ezzat: CONFIRMED appointment today, scheduled early -- the Live Queue timezone-bug repro case"
        ))

    # --- e2e.patient12: CONFIRMED right now, a "current time slot" case -----
    def _seed_current_time_confirmed(self, patient_profile, doctor_profile):
        today = timezone.localdate()
        already = Appointment.objects.filter(
            doctor=doctor_profile, patient=patient_profile,
            scheduled_start__date=today, status=AppointmentStatus.CONFIRMED,
        ).exists()
        if already:
            self.stdout.write("  Omar Nabil: already has a CONFIRMED appointment today, left as-is")
            return
        now = timezone.now()
        appt = Appointment.objects.create(
            patient=patient_profile, doctor=doctor_profile,
            scheduled_start=now,
            scheduled_end=now + timedelta(minutes=doctor_profile.avg_appointment_duration or 30),
            status=AppointmentStatus.PENDING, reason=f"{SEED_TAG} follow-up",
        )
        appt_services.confirm_appointment(appt)
        self.stdout.write(self.style.SUCCESS(
            "  Omar Nabil: CONFIRMED appointment scheduled right now (current-time-slot case)"
        ))

    # --- e2e.patient13: CHECKED_IN ("تم الوصول" / arrived), already queued --
    def _seed_arrived(self, patient_profile, doctor_profile, secretary_user):
        already = Appointment.objects.filter(
            doctor=doctor_profile, patient=patient_profile,
            status__in=[AppointmentStatus.CHECKED_IN, AppointmentStatus.IN_PROGRESS],
        ).exists()
        if already:
            self.stdout.write("  Salma Youssef: already CHECKED_IN/IN_PROGRESS, left as-is")
            return
        appt_services.create_walk_in(
            patient=patient_profile, doctor=doctor_profile,
            reason=f"{SEED_TAG} arrived walk-in", created_by=secretary_user,
        )
        self.stdout.write(self.style.SUCCESS(
            "  Salma Youssef: CHECKED_IN ('Arrived') walk-in, already sitting in the queue"
        ))

    # --- notifications for e2e.doctor, so the dropdown has content to check -
    def _seed_doctor_notifications(self, doctor_user):
        if doctor_user.notifications.count() >= len(DOCTOR_NOTIFICATIONS):
            self.stdout.write("  e2e.doctor: already has enough notifications, left as-is")
            return
        now = timezone.now()
        for minutes_ago, verb, title, title_ar, body, body_ar, is_read in DOCTOR_NOTIFICATIONS:
            n = notify(
                recipient=doctor_user, verb=verb, title=title, title_ar=title_ar,
                body=body, body_ar=body_ar, channels=["in_app"],
            )
            # Backdate past auto_now_add so the list shows a realistic spread
            # of ages (relativeTime in HeaderBell.tsx) instead of all "now".
            Notification = n.__class__
            Notification.objects.filter(pk=n.pk).update(
                created_at=now - timedelta(minutes=minutes_ago),
                is_read=is_read, read_at=(now - timedelta(minutes=minutes_ago)) if is_read else None,
            )
        self.stdout.write(self.style.SUCCESS(
            f"  e2e.doctor: seeded {len(DOCTOR_NOTIFICATIONS)} notifications spanning minutes to a day old"
        ))

    def _report(self):
        self.stdout.write(self.style.SUCCESS("\nReady. Log in at http://localhost:5173 (password E2eTest123!):"))
        self.stdout.write("  e2e.doctor@test.dev -> /doctor/queue")
        self.stdout.write("    - Elaria Ezzat: CONFIRMED, today early -- should now appear as 'next'/waiting")
        self.stdout.write("      (this is the exact bug report: early-morning appointments used to be invisible).")
        self.stdout.write("    - Omar Nabil: CONFIRMED, scheduled for right now.")
        self.stdout.write("    - Salma Youssef: CHECKED_IN ('Arrived'), already queued.")
        self.stdout.write("    Click the bell icon -> 10 varied notifications, oldest ~1 day, to check scrolling/padding.")
        self.stdout.write("    Switch language to Arabic to check the 12-hour time format and Arabic notification text.")
