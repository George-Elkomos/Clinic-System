"""Idempotent demo seed: roles, specialties, doctors + schedules, patients,
generated slots, and sample appointments (incl. a populated kiosk queue).

    python manage.py seed_data

Re-running is safe (everything is get_or_create / guarded).
"""
from datetime import time, timedelta

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.appointments.models import Appointment
from apps.appointments import services as appt_services
from apps.core.enums import (
    AppointmentStatus,
    AppointmentType,
    BloodType,
    GenderChoices,
    LabCategory,
    RoleChoices,
    SlotStatus,
    Weekday,
)
from apps.doctors.models import (
    DoctorPatient,
    DoctorProfile,
    Specialty,
    SpecialtyCategory,
    TimeSlot,
    WorkingSchedule,
)
from apps.doctors.services import slot_generator
from apps.medical_records.models import LabResult, MedicalRecord, Prescription, PrescriptionItem
from apps.medical_records.services.records import create_record_version
from apps.reviews.models import Review
from apps.users.models import PatientProfile, User

PASSWORD = "Clinic123!"


class Command(BaseCommand):
    help = "Seed the database with demo data for all roles."

    @transaction.atomic
    def handle(self, *args, **options):
        self.stdout.write("Seeding clinic data...")

        manager = self._user("manager@clinic.test", "Maya", "Manager", RoleChoices.MANAGER,
                              is_staff=True, is_superuser=True)
        self._user("secretary@clinic.test", "Sam", "Secretary", RoleChoices.SECRETARY)

        categories = {
            name: SpecialtyCategory.objects.get_or_create(
                name=name, defaults={"name_ar": ar}
            )[0]
            for name, ar in [
                ("Cardiovascular", "القلب والأوعية"),
                ("Dermatologic", "الجلدية"),
                ("General", "عام"),
            ]
        }
        specialties = {
            "Cardiology": self._specialty("Cardiology", "أمراض القلب", categories["Cardiovascular"]),
            "Dermatology": self._specialty("Dermatology", "الأمراض الجلدية", categories["Dermatologic"]),
            "General Practice": self._specialty("General Practice", "طب عام", categories["General"]),
            "Pediatrics": self._specialty("Pediatrics", "طب الأطفال", categories["General"]),
        }

        doctors = []
        doctor_specs = [
            ("dr.adams@clinic.test", "Alice", "Adams", "Cardiology", 15, "101"),
            ("dr.benali@clinic.test", "Bilal", "Ben Ali", "Dermatology", 20, "102"),
            ("dr.chen@clinic.test", "Chao", "Chen", "General Practice", 15, "103"),
        ]
        for email, first, last, spec, duration, room in doctor_specs:
            doctor = self._doctor(email, first, last, specialties[spec], duration, room)
            doctors.append(doctor)
            self._weekday_schedule(doctor)

        patients = []
        for i in range(1, 5):
            patients.append(self._patient(f"patient{i}@clinic.test", f"Pat{i}", "Visitor"))

        created = slot_generator.generate_all()
        self.stdout.write(f"  generated {created} slots")

        self._sample_appointments(doctors, patients)
        self._populate_kiosk(doctors[0], patients)
        self._seed_medical(doctors, patients)
        self._sample_reviews(doctors, patients)

        self.stdout.write(self.style.SUCCESS(
            "Done. Log in with any seeded email and password '%s'." % PASSWORD
        ))
        self.stdout.write("  Manager:   manager@clinic.test")
        self.stdout.write("  Secretary: secretary@clinic.test")
        self.stdout.write("  Doctors:   dr.adams@clinic.test, dr.benali@clinic.test, dr.chen@clinic.test")
        self.stdout.write("  Patients:  patient1@clinic.test ... patient4@clinic.test")

    # --- helpers ----------------------------------------------------------
    def _user(self, email, first, last, role, is_staff=False, is_superuser=False):
        user, created = User.objects.get_or_create(
            email=email,
            defaults={
                "first_name": first, "last_name": last, "role": role,
                "is_staff": is_staff, "is_superuser": is_superuser,
            },
        )
        if created:
            user.set_password(PASSWORD)
            user.save()
        return user

    def _specialty(self, name, name_ar, category):
        return Specialty.objects.get_or_create(
            name=name, defaults={"name_ar": name_ar, "category": category}
        )[0]

    def _doctor(self, email, first, last, specialty, duration, room):
        user = self._user(email, first, last, RoleChoices.DOCTOR)
        profile, _ = DoctorProfile.objects.get_or_create(
            user=user,
            defaults={
                "license_number": f"LIC-{user.pk:04d}",
                "bio": f"Dr. {first} {last}, {specialty.name} specialist.",
                "years_experience": 8,
                "avg_appointment_duration": duration,
                "room_number": room,
            },
        )
        profile.specialties.add(specialty)
        return profile

    def _weekday_schedule(self, doctor):
        for weekday in [Weekday.MONDAY, Weekday.TUESDAY, Weekday.WEDNESDAY,
                        Weekday.THURSDAY, Weekday.FRIDAY]:
            WorkingSchedule.objects.get_or_create(
                doctor=doctor, weekday=weekday, start_time=time(9, 0),
                valid_from=timezone.localdate(),
                defaults={"end_time": time(13, 0)},
            )

    def _patient(self, email, first, last):
        user = self._user(email, first, last, RoleChoices.PATIENT)
        profile = user.patient_profile  # created by signal
        if not profile.date_of_birth:
            profile.date_of_birth = timezone.localdate() - timedelta(days=365 * 60)
            profile.gender = GenderChoices.UNDISCLOSED
            profile.blood_type = BloodType.O_POS
            profile.emergency_contact_name = "Next of Kin"
            profile.emergency_contact_phone = "+10000000000"
            profile.save()
        return profile

    def _sample_appointments(self, doctors, patients):
        """Book a couple of real future slots (PENDING + CONFIRMED) for demo."""
        if Appointment.objects.filter(appointment_type=AppointmentType.SCHEDULED).exists():
            return
        doctor = doctors[0]
        slots = list(
            TimeSlot.objects.filter(doctor=doctor, status=SlotStatus.AVAILABLE,
                                    start_datetime__gte=timezone.now())
            .order_by("start_datetime")[:2]
        )
        if len(slots) >= 1:
            appt_services.book_slot(patient=patients[0], slot_id=slots[0].pk,
                                    reason="Routine check-up")
        if len(slots) >= 2:
            confirmed = appt_services.book_slot(patient=patients[1], slot_id=slots[1].pk,
                                                reason="Follow-up visit")
            appt_services.confirm_appointment(confirmed)

    def _populate_kiosk(self, doctor, patients):
        """Create today's queue (one IN_PROGRESS + a few waiting) so the public
        kiosk display has content regardless of the current time."""
        today = timezone.localdate()
        if Appointment.objects.filter(doctor=doctor, scheduled_start__date=today,
                                       status=AppointmentStatus.IN_PROGRESS).exists():
            return
        from datetime import datetime

        base = timezone.make_aware(datetime.combine(today, time(10, 0)))
        plan = [
            (AppointmentStatus.IN_PROGRESS, AppointmentType.SCHEDULED, 0),
            (AppointmentStatus.CHECKED_IN, AppointmentType.WALK_IN, 0),
            (AppointmentStatus.CONFIRMED, AppointmentType.EMERGENCY, 10),
            (AppointmentStatus.CONFIRMED, AppointmentType.SCHEDULED, 0),
        ]
        for i, (status, kind, priority) in enumerate(plan):
            patient = patients[i % len(patients)]
            start = base + timedelta(minutes=15 * i)
            Appointment.objects.create(
                patient=patient, doctor=doctor, scheduled_start=start,
                scheduled_end=start + timedelta(minutes=15),
                status=status, appointment_type=kind, priority=priority,
                reason="Demo queue entry",
            )

    def _seed_medical(self, doctors, patients):
        """Give each doctor a treated patient (completed appointment → DoctorPatient
        link) plus a sample record, prescription, and lab result."""
        if MedicalRecord.all_objects.exists():
            return
        for i, doctor in enumerate(doctors):
            patient = patients[i % len(patients)]
            slot = (
                TimeSlot.objects.filter(
                    doctor=doctor, status=SlotStatus.AVAILABLE,
                    start_datetime__gte=timezone.now(),
                ).order_by("start_datetime").first()
            )
            if slot:
                appt = appt_services.book_slot(
                    patient=patient, slot_id=slot.pk, reason="Initial consultation"
                )
                appt_services.complete_appointment(appt)  # creates the DoctorPatient link
            else:
                DoctorPatient.objects.get_or_create(doctor=doctor, patient=patient)

            create_record_version(
                patient=patient, doctor=doctor,
                data={
                    "chief_complaint": "General check-up",
                    "diagnosis": "Healthy; no acute issues",
                    "treatment_plan": "Routine follow-up in 6 months",
                    "vitals": {"bp": "120/80", "pulse": "72", "temp": "36.8"},
                    "appointment": None,
                },
            )
            presc = Prescription.objects.create(
                patient=patient, doctor=doctor, notes="Take with food."
            )
            PrescriptionItem.objects.create(
                prescription=presc, drug_name="Amoxicillin", dosage="500mg",
                frequency="3 times daily", duration="7 days",
                instructions="After meals",
            )
            LabResult.objects.create(
                patient=patient, uploaded_by=doctor.user,
                test_name="Complete Blood Count", category=LabCategory.BLOOD,
                result_value="Within normal range", result_date=timezone.localdate(),
            )

    def _sample_reviews(self, doctors, patients):
        if Review.objects.exists():
            return
        for i, doctor in enumerate(doctors):
            Review.objects.create(
                patient=patients[i % len(patients)], doctor=doctor,
                rating=5 - (i % 2), comment="Very kind and helpful.",
            )
