"""Audit finding #1 (High/PHI): a Secretary could read full clinical
lab-result content (values, ranges, units, abnormal/critical flags,
interpretation, and the result file) via the LabOrder detail endpoint and a
few adjacent actions, even though the standalone /api/lab-results/ endpoint
already 403s them outright. This locks the redaction in at the serializer
layer (results stay visible for logistics) and closes the raw file-download
bypass."""
import pytest
from django.urls import reverse
from django.utils import timezone

from apps.core.enums import LabOrderStatus, RoleChoices
from apps.medical_records.models import LabOrder, LabOrderItem, LabOrderResult

pytestmark = pytest.mark.django_db

CLINICAL_KEYS = {"result_value", "unit", "reference_range", "is_abnormal", "is_critical", "interpretation", "file"}


@pytest.fixture
def manager(make_user):
    return make_user("mgr-phi@test.dev", RoleChoices.MANAGER, first_name="Man", last_name="Ager")


@pytest.fixture
def order_with_results(doctor_profile, patient):
    order = LabOrder.objects.create(
        patient=patient.patient_profile,
        doctor=doctor_profile,
        status=LabOrderStatus.COMPLETED,
        ordered_at=timezone.now(),
        completed_at=timezone.now(),
    )
    item = LabOrderItem.objects.create(order=order, test_name="CBC")
    LabOrderResult.objects.create(
        order=order, order_item=item, test_name="CBC",
        result_value="14.2", unit="g/dL", reference_range="12-16",
        is_abnormal=False, is_critical=True,
        result_date=timezone.localdate(),
        interpretation="Borderline — recommend retest.",
    )
    return order


# --- GET /api/lab-orders/{id}/ -----------------------------------------------

def test_secretary_lab_order_detail_hides_clinical_result_fields(api, secretary, order_with_results):
    api.force_authenticate(secretary)
    resp = api.get(reverse("lab-order-detail", args=[order_with_results.id]))
    assert resp.status_code == 200
    results = resp.data["results"]
    assert len(results) == 1
    row = results[0]
    assert CLINICAL_KEYS.isdisjoint(row.keys())
    assert row["test_name"] == "CBC"
    assert "result_date" in row
    assert "entered_by_name" in row


def test_secretary_lab_order_detail_hides_has_critical(api, secretary, order_with_results):
    api.force_authenticate(secretary)
    resp = api.get(reverse("lab-order-detail", args=[order_with_results.id]))
    assert resp.status_code == 200
    assert resp.data["has_critical"] is False


def test_doctor_still_sees_full_clinical_results(api, doctor_profile, order_with_results):
    api.force_authenticate(doctor_profile.user)
    resp = api.get(reverse("lab-order-detail", args=[order_with_results.id]))
    assert resp.status_code == 200
    row = resp.data["results"][0]
    assert row["result_value"] == "14.2"
    assert row["is_critical"] is True
    assert resp.data["has_critical"] is True


def test_manager_still_sees_full_clinical_results(api, manager, order_with_results):
    api.force_authenticate(manager)
    resp = api.get(reverse("lab-order-detail", args=[order_with_results.id]))
    assert resp.status_code == 200
    row = resp.data["results"][0]
    assert row["result_value"] == "14.2"
    assert resp.data["has_critical"] is True


def test_patient_owner_still_gated_pre_review(api, patient, order_with_results):
    # Regression control: the pre-existing patient/REVIEWED gate (CW-2) must
    # keep working after restructuring get_results() for the secretary branch.
    api.force_authenticate(patient)
    resp = api.get(reverse("lab-order-detail", args=[order_with_results.id]))
    assert resp.status_code == 200
    assert resp.data["results"] == []


# --- File download bypass ----------------------------------------------------

def test_secretary_cannot_download_result_file(api, secretary, order_with_results):
    result = order_with_results.results.first()
    api.force_authenticate(secretary)
    resp = api.get(reverse("lab-order-download-result-file", args=[order_with_results.id, result.id]))
    assert resp.status_code == 403


def test_manager_download_action_unaffected(api, manager, order_with_results):
    # No file attached in the fixture, so a manager still reaches the
    # "no file attached" validation error rather than a permission error —
    # confirms the new secretary check above is role-specific, not a blanket
    # regression on the download action.
    result = order_with_results.results.first()
    api.force_authenticate(manager)
    resp = api.get(reverse("lab-order-download-result-file", args=[order_with_results.id, result.id]))
    assert resp.status_code == 400


# --- Other secretary-reachable actions must redact too -----------------------

def test_secretary_start_processing_response_is_also_redacted(api, secretary, doctor_profile, patient):
    order = LabOrder.objects.create(
        patient=patient.patient_profile, doctor=doctor_profile,
        status=LabOrderStatus.SAMPLE_COLLECTED, ordered_at=timezone.now(),
    )
    LabOrderResult.objects.create(
        order=order, test_name="Glucose", result_value="95", unit="mg/dL",
        result_date=timezone.localdate(), is_critical=True,
    )
    api.force_authenticate(secretary)
    resp = api.post(reverse("lab-order-start-processing", args=[order.id]))
    assert resp.status_code == 200
    assert CLINICAL_KEYS.isdisjoint(resp.data["results"][0].keys())
    assert resp.data["has_critical"] is False


# --- Alignment with the standalone lab-results endpoint ----------------------

def test_secretary_still_403_on_standalone_lab_results_endpoint(api, secretary):
    """Anchors the alignment the fix targets: secretary access to the
    standalone clinical endpoint stays exactly as restricted as before."""
    api.force_authenticate(secretary)
    resp = api.get(reverse("lab-result-list"))
    assert resp.status_code == 403
