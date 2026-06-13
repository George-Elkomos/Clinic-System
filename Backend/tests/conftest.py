from datetime import time, timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.enums import RoleChoices, Weekday
from apps.doctors.models import DoctorProfile, Specialty, SpecialtyCategory, WorkingSchedule
from apps.doctors.services import slot_generator
from apps.users.models import User


@pytest.fixture
def api():
    return APIClient()


@pytest.fixture
def make_user(db):
    def _make(email, role, password="Clinic123!", **extra):
        user = User.objects.create_user(email=email, password=password, role=role, **extra)
        return user
    return _make


@pytest.fixture
def patient(make_user):
    return make_user("p1@test.dev", RoleChoices.PATIENT, first_name="Pat", last_name="One")


@pytest.fixture
def patient2(make_user):
    return make_user("p2@test.dev", RoleChoices.PATIENT, first_name="Pat", last_name="Two")


@pytest.fixture
def secretary(make_user):
    return make_user("sec@test.dev", RoleChoices.SECRETARY)


@pytest.fixture
def doctor_profile(make_user, db):
    user = make_user("doc@test.dev", RoleChoices.DOCTOR, first_name="Dee", last_name="Oc")
    category = SpecialtyCategory.objects.create(name="General")
    specialty = Specialty.objects.create(name="General Practice", category=category)
    profile = DoctorProfile.objects.create(
        user=user, license_number="LIC-T1", avg_appointment_duration=30
    )
    profile.specialties.add(specialty)
    # A schedule today so slots generate within the horizon.
    WorkingSchedule.objects.create(
        doctor=profile, weekday=timezone.localdate().weekday(),
        start_time=time(0, 0), end_time=time(23, 0),
        valid_from=timezone.localdate(),
    )
    return profile


@pytest.fixture
def future_slot(doctor_profile):
    """A guaranteed-future AVAILABLE slot for booking tests."""
    slot_generator.generate_slots_for_doctor(
        doctor_profile, timezone.localdate(), timezone.localdate() + timedelta(days=1)
    )
    from apps.core.enums import SlotStatus
    from apps.doctors.models import TimeSlot

    return (
        TimeSlot.objects.filter(
            doctor=doctor_profile, status=SlotStatus.AVAILABLE,
            start_datetime__gte=timezone.now() + timedelta(minutes=30),
        )
        .order_by("start_datetime")
        .first()
    )
