"""One-shot fixture for manually verifying Phase 16 (Advanced Analytics)
without walking through 6 months of manual appointment/lab-order creation.

    python manage.py seed_analytics_e2e

Re-running is safe: each (doctor, month) appointment bucket and each
(doctor, month) lab-order bucket is tagged and only created if missing, so
reruns top up rather than duplicate.

Unlike prior phase seed commands (one row per lifecycle bucket), this
command backfills BACKDATED HISTORICAL SPREAD across the last 6 calendar
months, since the new specialty/lab analytics endpoints and the monthly
growth-trend line chart need real month-over-month variation to render
meaningfully — a handful of "as of today" rows wouldn't exercise them.

What it guarantees on the e2e.* accounts (see .claude/skills/verify/SKILL.md
for the passwords/routes):
  - e2e.doctor has 0 specialties (the "doctor with no specialty" edge case —
    already true from prior seed commands, left untouched here).
  - e2e.doctor2 has exactly 1 specialty (Cardiology, from seed_referrals_e2e).
  - e2e.doctor3 (new) has 2 specialties (Cardiology + Dermatology) — the
    multi-specialty fan-out edge case for /reports/specialty-analytics/.
  - e2e.patient5 (new) has ~3 appointments/month for each of the 3 doctors
    over the trailing 6 months, with a realistic status mix (~2/3 COMPLETED
    with varied check-in/start/complete offsets for wait-time spread, the
    rest split NO_SHOW/CANCELLED).
  - ~24 LabOrders spread over the same 6 months (doctor2 + doctor3), drawn
    from a fixed 6-test vocabulary, ~75% COMPLETED with a LabOrderResult
    (~20% flagged is_abnormal=True), ~25% left PROCESSING with no results
    yet — the "lab order with no results" edge case, achieved naturally.
"""
from datetime import datetime, timedelta

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.core.enums import AppointmentStatus, AppointmentType, LabOrderStatus, RoleChoices
from apps.doctors.models import DoctorProfile, Specialty, SpecialtyCategory
from apps.users.models import User

PASSWORD = "E2eTest123!"
SEED_TAG = "[e2e-analytics-seed]"
MONTHS_BACK = 6

LAB_TESTS = [
    ("CBC", "x10^9/L", "4.0-11.0"),
    ("Lipid Panel", "mg/dL", "<200"),
    ("HbA1c", "%", "4.0-5.6"),
    ("Liver Function Panel", "U/L", "7-56"),
    ("Urinalysis", "", "Negative"),
    ("Thyroid Panel (TSH)", "mIU/L", "0.4-4.0"),
]


class Command(BaseCommand):
    help = "Seed Phase 16 analytics fixtures (6 months of historical appointments + lab orders) onto the e2e.* accounts for manual/browser testing."

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._lab_counter = 0

    @transaction.atomic
    def handle(self, *args, **options):
        from apps.appointments.models import Appointment
        from apps.medical_records.models import LabOrder, LabOrderItem, LabOrderResult

        self.Appointment = Appointment
        self.LabOrder = LabOrder
        self.LabOrderItem = LabOrderItem
        self.LabOrderResult = LabOrderResult

        patient_user = self._user("e2e.patient5@test.dev", "Yara", "Fathy", RoleChoices.PATIENT)
        doctor_user = self._user("e2e.doctor@test.dev", "Mona", "Adly", RoleChoices.DOCTOR)
        doctor2_user = self._user("e2e.doctor2@test.dev", "Karim", "Nabil", RoleChoices.DOCTOR)
        doctor3_user = self._user("e2e.doctor3@test.dev", "Heba", "Farouk", RoleChoices.DOCTOR)
        secretary_user = self._user("e2e.secretary@test.dev", "Sara", "Desk", RoleChoices.SECRETARY)
        self._user("e2e.manager@test.dev", "Big", "Boss", RoleChoices.MANAGER)

        doctor_profile, _ = DoctorProfile.objects.get_or_create(
            user=doctor_user, defaults={"license_number": f"LIC-E2E-{doctor_user.pk}"}
        )
        doctor2_profile, _ = DoctorProfile.objects.get_or_create(
            user=doctor2_user, defaults={"license_number": f"LIC-E2E-{doctor2_user.pk}"}
        )
        doctor3_profile, _ = DoctorProfile.objects.get_or_create(
            user=doctor3_user, defaults={"license_number": f"LIC-E2E-{doctor3_user.pk}"}
        )
        patient_profile = patient_user.patient_profile

        cardiology, dermatology = self._specialties()
        doctor2_profile.specialties.add(cardiology)
        doctor3_profile.specialties.add(cardiology, dermatology)
        # doctor_profile deliberately left with 0 specialties (edge case).

        months = self._trailing_months(MONTHS_BACK)

        for year, month in months:
            for doctor_profile_i in (doctor_profile, doctor2_profile, doctor3_profile):
                self._ensure_month_appointments(
                    patient_profile, doctor_profile_i, secretary_user, year, month
                )
            self._ensure_month_lab_orders(patient_profile, doctor2_profile, secretary_user, year, month)
            self._ensure_month_lab_orders(patient_profile, doctor3_profile, secretary_user, year, month)

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

    def _specialties(self):
        cardio_cat, _ = SpecialtyCategory.objects.get_or_create(
            name="Cardiovascular", defaults={"name_ar": "القلب والأوعية"}
        )
        cardiology, _ = Specialty.objects.get_or_create(
            name="Cardiology", defaults={"name_ar": "أمراض القلب", "category": cardio_cat}
        )
        derma_cat, _ = SpecialtyCategory.objects.get_or_create(
            name="Dermatology", defaults={"name_ar": "الأمراض الجلدية"}
        )
        dermatology, _ = Specialty.objects.get_or_create(
            name="Dermatology", defaults={"name_ar": "الأمراض الجلدية", "category": derma_cat}
        )
        return cardiology, dermatology

    def _trailing_months(self, count):
        """Oldest-first list of (year, month) tuples, trailing back from the
        current calendar month (inclusive)."""
        today = timezone.localdate()
        y, m = today.year, today.month
        months = []
        for _ in range(count):
            months.append((y, m))
            m -= 1
            if m == 0:
                m, y = 12, y - 1
        return list(reversed(months))

    def _at(self, year, month, day, hour):
        return timezone.now().replace(
            year=year, month=month, day=day, hour=hour, minute=0, second=0, microsecond=0
        )

    # --- appointments -----------------------------------------------------
    def _appt_tag(self, doctor_profile, year, month):
        return f"{SEED_TAG} doctor={doctor_profile.id} m={year}-{month:02d}"

    def _ensure_month_appointments(self, patient_profile, doctor_profile, secretary_user, year, month):
        tag = self._appt_tag(doctor_profile, year, month)
        if self.Appointment.objects.filter(doctor=doctor_profile, reason__icontains=tag).exists():
            return

        days = [5, 15, 25]
        outcomes = [
            AppointmentStatus.COMPLETED,
            AppointmentStatus.COMPLETED,
            AppointmentStatus.CANCELLED if month % 2 == 0 else AppointmentStatus.NO_SHOW,
        ]

        for i, day in enumerate(days):
            start = self._at(year, month, day, 9 + i * 2)
            end = start + timedelta(minutes=30)
            status = outcomes[i]
            appt = self.Appointment(
                patient=patient_profile, doctor=doctor_profile,
                scheduled_start=start, scheduled_end=end,
                status=status, appointment_type=AppointmentType.SCHEDULED,
                reason=tag, created_by=secretary_user,
            )
            if status == AppointmentStatus.COMPLETED:
                appt.checked_in_at = start + timedelta(minutes=2 + i * 3)
                appt.started_at = appt.checked_in_at + timedelta(minutes=8 + i * 5)
                appt.completed_at = appt.started_at + timedelta(minutes=15 + i * 5)
            elif status == AppointmentStatus.CANCELLED:
                appt.cancellation_reason = f"{tag} patient rescheduled"
            appt.save()

        self.stdout.write(self.style.SUCCESS(
            f"  appointments[{doctor_profile}]: seeded 3 for {year}-{month:02d}"
        ))

    # --- lab orders ---------------------------------------------------------
    def _lab_tag(self, doctor_profile, year, month):
        return f"{SEED_TAG} doctor={doctor_profile.id} m={year}-{month:02d}"

    def _ensure_month_lab_orders(self, patient_profile, doctor_profile, secretary_user, year, month):
        tag = self._lab_tag(doctor_profile, year, month)
        if self.LabOrder.objects.filter(doctor=doctor_profile, clinical_notes__icontains=tag).exists():
            return

        for i in range(2):
            n = self._lab_counter
            self._lab_counter += 1
            test_name, unit, ref_range = LAB_TESTS[n % len(LAB_TESTS)]
            ordered_at = self._at(year, month, 10 + i * 10, 9)
            completed = (n % 4) != 3  # ~75% completed, ~25% left in-progress
            is_abnormal = (n % 5) == 0  # ~20% abnormal

            order = self.LabOrder(
                patient=patient_profile, doctor=doctor_profile,
                status=LabOrderStatus.COMPLETED if completed else LabOrderStatus.PROCESSING,
                ordered_at=ordered_at, clinical_notes=tag,
            )
            if completed:
                order.completed_at = ordered_at + timedelta(hours=4 + (n % 5) * 8)
            order.save()

            item = self.LabOrderItem.objects.create(order=order, test_name=test_name)
            if completed:
                self.LabOrderResult.objects.create(
                    order=order, order_item=item, test_name=test_name,
                    result_value="Out of range" if is_abnormal else "Within range",
                    unit=unit, reference_range=ref_range,
                    is_abnormal=is_abnormal, result_date=order.completed_at.date(),
                    entered_by=secretary_user,
                )

        self.stdout.write(self.style.SUCCESS(
            f"  lab orders[{doctor_profile}]: seeded 2 for {year}-{month:02d}"
        ))

    def _report(self):
        self.stdout.write(self.style.SUCCESS("\nReady. Log in at http://localhost:5173 (password E2eTest123!):"))
        self.stdout.write(
            "  e2e.manager@test.dev -> /manager/reports : Specialty Analytics, Specialty Growth "
            "Trend, Top Diagnoses, and Lab Analytics sections all have 6 months of seeded data"
        )
        self.stdout.write(
            "  Specialty fan-out: e2e.doctor has 0 specialties, e2e.doctor2 has Cardiology, "
            "e2e.doctor3 has Cardiology + Dermatology (its appointments count toward both)"
        )
        self.stdout.write(
            "  Lab analytics: e2e.doctor2/e2e.doctor3 have ~24 LabOrders total across a 6-test "
            "vocabulary, mixed COMPLETED (with abnormal/normal results) and still-PROCESSING"
        )
