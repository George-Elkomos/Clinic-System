"""Staff management tests: create doctor/secretary/patient, user CRUD, patient profile editing."""
import pytest
from django.urls import reverse

from apps.core.enums import RoleChoices
from apps.doctors.models import DoctorProfile
from apps.users.models import PatientProfile, User

pytestmark = pytest.mark.django_db


# --- Fixtures ---------------------------------------------------------------

@pytest.fixture
def manager(make_user):
    return make_user("mgr@staff.dev", RoleChoices.MANAGER)


@pytest.fixture
def secretary(make_user):
    return make_user("sec@staff.dev", RoleChoices.SECRETARY)


@pytest.fixture
def patient(make_user):
    return make_user("pat@staff.dev", RoleChoices.PATIENT, first_name="Joe", last_name="Doe")


@pytest.fixture
def specialty(db):
    from apps.doctors.models import Specialty, SpecialtyCategory
    cat = SpecialtyCategory.objects.create(name="Test Cat")
    return Specialty.objects.create(name="Test Specialty", category=cat)


# --- Create doctor ----------------------------------------------------------

def test_manager_creates_doctor(api, manager, specialty):
    api.force_authenticate(manager)
    resp = api.post(reverse("staff-create-doctor"), {
        "first_name": "Alice",
        "last_name": "Smith",
        "email": "dr.alice@test.dev",
        "phone": "1111",
        "license_number": "LIC-NEW",
        "specialties": [specialty.pk],
        "room_number": "101",
    }, format="json")
    assert resp.status_code == 201
    assert "temp_password" in resp.data
    assert User.objects.filter(email="dr.alice@test.dev", role=RoleChoices.DOCTOR).exists()
    assert DoctorProfile.objects.filter(license_number="LIC-NEW").exists()


def test_manager_creates_doctor_with_explicit_password(api, manager):
    api.force_authenticate(manager)
    resp = api.post(reverse("staff-create-doctor"), {
        "first_name": "Bob",
        "last_name": "Jones",
        "email": "dr.bob@test.dev",
        "license_number": "LIC-BOB",
        "password": "SecurePass1!",
    }, format="json")
    assert resp.status_code == 201
    assert resp.data["temp_password"] is None  # caller supplied password → no temp


def test_duplicate_email_rejected(api, manager):
    api.force_authenticate(manager)
    api.post(reverse("staff-create-doctor"), {
        "first_name": "X", "last_name": "Y",
        "email": "dup@test.dev", "license_number": "LIC-X1",
    }, format="json")
    resp = api.post(reverse("staff-create-doctor"), {
        "first_name": "X2", "last_name": "Y2",
        "email": "dup@test.dev", "license_number": "LIC-X2",
    }, format="json")
    assert resp.status_code == 400


def test_duplicate_license_rejected(api, manager):
    api.force_authenticate(manager)
    api.post(reverse("staff-create-doctor"), {
        "first_name": "A", "last_name": "B",
        "email": "dr.a@test.dev", "license_number": "LIC-SAME",
    }, format="json")
    resp = api.post(reverse("staff-create-doctor"), {
        "first_name": "C", "last_name": "D",
        "email": "dr.c@test.dev", "license_number": "LIC-SAME",
    }, format="json")
    assert resp.status_code == 400


def test_patient_cannot_create_doctor(api, patient):
    api.force_authenticate(patient)
    resp = api.post(reverse("staff-create-doctor"), {
        "first_name": "E", "last_name": "F",
        "email": "dr.e@test.dev", "license_number": "LIC-E",
    }, format="json")
    assert resp.status_code == 403


# --- Create secretary -------------------------------------------------------

def test_manager_creates_secretary(api, manager):
    api.force_authenticate(manager)
    resp = api.post(reverse("staff-create-secretary"), {
        "first_name": "Sara",
        "last_name": "Admin",
        "email": "sara@test.dev",
    }, format="json")
    assert resp.status_code == 201
    assert User.objects.filter(email="sara@test.dev", role=RoleChoices.SECRETARY).exists()
    assert resp.data["temp_password"] is not None


def test_secretary_cannot_create_secretary(api, secretary):
    api.force_authenticate(secretary)
    resp = api.post(reverse("staff-create-secretary"), {
        "first_name": "T", "last_name": "T", "email": "t@test.dev",
    }, format="json")
    assert resp.status_code == 403


# --- Create patient (staff) -------------------------------------------------

def test_secretary_creates_minimal_patient(api, secretary):
    api.force_authenticate(secretary)
    resp = api.post(reverse("staff-create-patient"), {
        "first_name": "Walk",
        "last_name": "In",
        "phone": "0500001111",
    }, format="json")
    assert resp.status_code == 201
    assert resp.data["email_placeholder"] is True
    assert resp.data["temp_password"]
    assert PatientProfile.objects.filter(pk=resp.data["patient_profile_id"]).exists()


def test_patient_phone_or_email_required(api, secretary):
    api.force_authenticate(secretary)
    resp = api.post(reverse("staff-create-patient"), {
        "first_name": "No", "last_name": "Contact",
    }, format="json")
    assert resp.status_code == 400


def test_duplicate_national_id_rejected(api, secretary):
    api.force_authenticate(secretary)
    api.post(reverse("staff-create-patient"), {
        "first_name": "A", "last_name": "B", "phone": "111", "national_id": "ID123",
    }, format="json")
    resp = api.post(reverse("staff-create-patient"), {
        "first_name": "C", "last_name": "D", "phone": "222", "national_id": "ID123",
    }, format="json")
    assert resp.status_code == 400


def test_patient_cannot_create_staff_patient(api, patient):
    api.force_authenticate(patient)
    resp = api.post(reverse("staff-create-patient"), {
        "first_name": "Z", "last_name": "Z", "phone": "000",
    }, format="json")
    assert resp.status_code == 403


# --- User management --------------------------------------------------------

def test_manager_lists_users_by_role(api, manager, patient):
    api.force_authenticate(manager)
    resp = api.get(reverse("staff-user-list") + "?role=PATIENT")
    assert resp.status_code == 200
    ids = [u["id"] for u in resp.data]
    assert patient.pk in ids


def test_manager_deactivates_and_reactivates(api, manager, patient):
    api.force_authenticate(manager)
    resp = api.post(reverse("staff-user-deactivate", args=[patient.pk]))
    assert resp.status_code == 200
    patient.refresh_from_db()
    assert patient.is_active is False

    resp = api.post(reverse("staff-user-reactivate", args=[patient.pk]))
    assert resp.status_code == 200
    patient.refresh_from_db()
    assert patient.is_active is True


def test_manager_resets_password(api, manager, patient):
    api.force_authenticate(manager)
    resp = api.post(reverse("staff-user-reset-password", args=[patient.pk]))
    assert resp.status_code == 200
    assert "temp_password" in resp.data
    # old password no longer works
    login_resp = api.post(reverse("auth-login"), {
        "email": patient.email, "password": "Clinic123!",
    }, format="json")
    assert login_resp.status_code == 401


# --- Patient profile staff edit ---------------------------------------------

def test_secretary_edits_patient_profile(api, secretary, patient):
    profile = patient.patient_profile
    api.force_authenticate(secretary)
    resp = api.patch(
        reverse("staff-patient-profile", args=[profile.pk]),
        {"blood_type": "A+", "date_of_birth": "1990-05-15"},
        format="json",
    )
    assert resp.status_code == 200
    profile.refresh_from_db()
    assert profile.blood_type == "A+"


# --- PatientDirectoryView phone search --------------------------------------

def test_patient_directory_search_by_phone(api, secretary, make_user):
    make_user("phone_pat@test.dev", RoleChoices.PATIENT,
              first_name="Phone", last_name="Pat", phone="0599123456")
    api.force_authenticate(secretary)
    resp = api.get("/api/patients/?search=0599123456")
    assert resp.status_code == 200
    assert any("Phone" in r["full_name"] for r in resp.data)


# --- Public doctors returns new fields --------------------------------------

def test_public_doctors_returns_photo_and_availability(api, doctor_profile):
    resp = api.get("/api/public/doctors/")
    assert resp.status_code == 200
    doc = next((d for d in resp.data["results"] if d["id"] == doctor_profile.pk), None)
    assert doc is not None
    assert "next_available_date" in doc
    assert "accepts_walk_ins" in doc
    assert "is_accepting_patients" in doc
