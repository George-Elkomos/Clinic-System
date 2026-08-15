"""Secretary permission scoping across doctor schedules/absences, lab result
entry, and prescriptions: secretaries handle desk/logistics work but not
clinical content or a doctor's own schedule management."""
import pytest
from django.urls import reverse
from django.utils import timezone

from apps.core.enums import RoleChoices
from apps.doctors.models import DoctorAbsence, DoctorPatient, DoctorProfile, WorkingSchedule
from apps.medical_records.models import LabOrder, Prescription

pytestmark = pytest.mark.django_db


@pytest.fixture
def manager(make_user):
    return make_user("mgr-sec@test.dev", RoleChoices.MANAGER, first_name="Man", last_name="Ager")


# --- Working schedules / absences: secretary is read-only -------------------

def test_secretary_cannot_create_working_schedule(api, secretary, doctor_profile):
    api.force_authenticate(secretary)
    resp = api.post(reverse("working-schedule-list"), {
        "doctor": doctor_profile.id, "weekday": 1,
        "start_time": "09:00", "end_time": "12:00", "valid_from": timezone.localdate().isoformat(),
    }, format="json")
    assert resp.status_code == 403


def test_secretary_can_view_working_schedules(api, secretary, doctor_profile):
    api.force_authenticate(secretary)
    resp = api.get(reverse("working-schedule-list"))
    assert resp.status_code == 200


def test_manager_can_create_working_schedule(api, manager, doctor_profile):
    api.force_authenticate(manager)
    resp = api.post(reverse("working-schedule-list"), {
        "doctor": doctor_profile.id, "weekday": 2,
        "start_time": "09:00", "end_time": "12:00", "valid_from": timezone.localdate().isoformat(),
    }, format="json")
    assert resp.status_code == 201


def test_secretary_cannot_edit_or_delete_absence(api, secretary, doctor_profile):
    absence = DoctorAbsence.objects.create(
        doctor=doctor_profile, start_date=timezone.localdate(), end_date=timezone.localdate(),
        absence_type="VACATION", created_by=doctor_profile.user,
    )
    api.force_authenticate(secretary)
    resp = api.patch(reverse("doctor-absence-detail", args=[absence.id]), {"reason": "x"}, format="json")
    assert resp.status_code == 403
    resp = api.delete(reverse("doctor-absence-detail", args=[absence.id]))
    assert resp.status_code == 403
    resp = api.get(reverse("doctor-absence-detail", args=[absence.id]))
    assert resp.status_code == 200


def test_secretary_cannot_create_absence(api, secretary, doctor_profile):
    api.force_authenticate(secretary)
    resp = api.post(reverse("doctor-absence-list"), {
        "doctor": doctor_profile.id, "start_date": timezone.localdate().isoformat(),
        "end_date": timezone.localdate().isoformat(), "absence_type": "VACATION",
    }, format="json")
    assert resp.status_code == 403


# --- Lab results: entering values is the ordering doctor's or a manager's ---

def test_secretary_cannot_enter_lab_results(api, secretary, doctor_profile, patient):
    order = LabOrder.objects.create(doctor=doctor_profile, patient=patient.patient_profile, status="PROCESSING")
    api.force_authenticate(secretary)
    resp = api.post(reverse("lab-order-enter-results", args=[order.id]), {"results": []}, format="json")
    assert resp.status_code == 403


def test_manager_can_enter_lab_results(api, manager, doctor_profile, patient):
    order = LabOrder.objects.create(doctor=doctor_profile, patient=patient.patient_profile, status="PROCESSING")
    api.force_authenticate(manager)
    resp = api.post(reverse("lab-order-enter-results", args=[order.id]), {"results": []}, format="json")
    assert resp.status_code == 200


def test_ordering_doctor_can_enter_lab_results(api, doctor_profile, patient):
    order = LabOrder.objects.create(doctor=doctor_profile, patient=patient.patient_profile, status="PROCESSING")
    api.force_authenticate(doctor_profile.user)
    resp = api.post(reverse("lab-order-enter-results", args=[order.id]), {"results": []}, format="json")
    assert resp.status_code == 200
    assert resp.data["status"] == "COMPLETED"


def test_treating_but_not_ordering_doctor_cannot_enter_lab_results(api, doctor_profile, patient, make_user):
    order = LabOrder.objects.create(doctor=doctor_profile, patient=patient.patient_profile, status="PROCESSING")
    treating = make_user("doc-lab-treating@test.dev", RoleChoices.DOCTOR)
    treating_profile = DoctorProfile.objects.create(user=treating, license_number="LIC-LAB-TREAT")
    DoctorPatient.objects.create(doctor=treating_profile, patient=patient.patient_profile)

    api.force_authenticate(treating)
    resp = api.post(reverse("lab-order-enter-results", args=[order.id]), {"results": []}, format="json")
    assert resp.status_code == 403


def test_unrelated_doctor_cannot_enter_lab_results(api, doctor_profile, patient, make_user):
    order = LabOrder.objects.create(doctor=doctor_profile, patient=patient.patient_profile, status="PROCESSING")
    other = make_user("doc-lab-unrelated@test.dev", RoleChoices.DOCTOR)
    DoctorProfile.objects.create(user=other, license_number="LIC-LAB-OTHER")

    api.force_authenticate(other)
    resp = api.post(reverse("lab-order-enter-results", args=[order.id]), {"results": []}, format="json")
    assert resp.status_code == 404


# --- Prescriptions: secretary is read-only (view/print) ---------------------

def test_secretary_can_list_and_read_prescriptions(api, secretary, doctor_profile, patient):
    rx = Prescription.objects.create(doctor=doctor_profile, patient=patient.patient_profile)
    api.force_authenticate(secretary)
    resp = api.get(reverse("prescription-list"))
    assert resp.status_code == 200
    assert any(r["id"] == rx.id for r in resp.data["results"])
    resp = api.get(reverse("prescription-detail", args=[rx.id]))
    assert resp.status_code == 200


def test_secretary_cannot_create_or_cancel_prescription(api, secretary, doctor_profile, patient):
    rx = Prescription.objects.create(doctor=doctor_profile, patient=patient.patient_profile)
    api.force_authenticate(secretary)
    resp = api.post(reverse("prescription-list"), {"patient": patient.patient_profile.id, "items": []}, format="json")
    assert resp.status_code == 403
    resp = api.post(reverse("prescription-cancel", args=[rx.id]), {"cancellation_reason": "x"}, format="json")
    assert resp.status_code == 403
