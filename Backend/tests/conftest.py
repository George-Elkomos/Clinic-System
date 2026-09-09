from calendar import monthrange
from datetime import date, time, timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.enums import RoleChoices, Weekday
from apps.doctors.models import DoctorProfile, Specialty, SpecialtyCategory, WorkingSchedule
from apps.doctors.services import slot_generator
from apps.users.models import User


@pytest.fixture(scope="session")
def django_db_setup(django_db_setup, django_db_blocker):
    """Seed the chart of accounts + an open Period covering "today" ONCE for
    the whole test run (not per-test): every invoice issue / payment (Task 6)
    posts to the ledger, which needs both to exist. Session-scoped and run
    outside any per-test transaction, so it persists across the whole suite
    instead of needing to be recreated (and re-checked for overlap) by every
    single test that happens to touch billing."""
    with django_db_blocker.unblock():
        from django.core.management import call_command

        from apps.accounting.models import FiscalYear, Period

        call_command("seed_chart_of_accounts", verbosity=0)

        today = timezone.localdate()
        # A distinctive name (not the "FY{year}" pattern tests use for their
        # own fixtures) so this baseline row never collides with one a test
        # creates in its own rolled-back transaction — it's committed outside
        # every test's transaction and persists for the whole session.
        fiscal_year, _ = FiscalYear.objects.get_or_create(
            name=f"FY-test-baseline-{today.year}",
            defaults={"start_date": date(today.year, 1, 1), "end_date": date(today.year, 12, 31)},
        )
        if Period.for_date(today) is None:
            last_day = monthrange(today.year, today.month)[1]
            Period.objects.create(
                fiscal_year=fiscal_year, name=today.strftime("%Y-%m"),
                start_date=date(today.year, today.month, 1),
                end_date=date(today.year, today.month, last_day),
            )
    return django_db_setup


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
