"""Phase 11 verification: sample collection lifecycle (collect -> send -> receive),
sample-ID generation, role scoping, and the printable specimen label."""
import pytest
from django.urls import reverse
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.core.enums import LabOrderPriority, LabOrderStatus, RoleChoices, SampleType
from apps.doctors.models import DoctorPatient
from apps.medical_records.models import LabOrder, LabOrderItem, SampleCollection
from apps.medical_records.services import lab_orders as lab_order_service

pytestmark = pytest.mark.django_db


@pytest.fixture
def treated(doctor_profile, patient):
    DoctorPatient.objects.create(doctor=doctor_profile, patient=patient.patient_profile)
    return patient


@pytest.fixture
def manager(make_user):
    return make_user("mgr@test.dev", RoleChoices.MANAGER, first_name="Man", last_name="Ager")


def _make_order(doctor_profile, treated, status=LabOrderStatus.ORDERED, priority=LabOrderPriority.ROUTINE):
    order = LabOrder.objects.create(
        patient=treated.patient_profile,
        doctor=doctor_profile,
        status=status,
        priority=priority,
        ordered_at=timezone.now(),
    )
    LabOrderItem.objects.create(order=order, test_name="CBC")
    return order


@pytest.fixture
def ordered_order(doctor_profile, treated):
    return _make_order(doctor_profile, treated)


@pytest.fixture
def collected_order(doctor_profile, treated, secretary):
    order = _make_order(doctor_profile, treated, status=LabOrderStatus.SAMPLE_COLLECTED)
    SampleCollection.objects.create(
        lab_order=order, sample_type=SampleType.SERUM,
        collected_by=secretary, collected_at=timezone.now(),
    )
    return order


@pytest.fixture
def processing_order(collected_order):
    collected_order.status = LabOrderStatus.PROCESSING
    collected_order.save(update_fields=["status"])
    collected_order.sample_collection.sent_to_lab_at = timezone.now()
    collected_order.sample_collection.save(update_fields=["sent_to_lab_at"])
    return collected_order


# --- sample_id generation -----------------------------------------------------
def test_sample_id_format_and_sequencing(api, secretary, doctor_profile, treated):
    order1 = _make_order(doctor_profile, treated)
    order2 = _make_order(doctor_profile, treated)

    api.force_authenticate(secretary)
    r1 = api.post(reverse("lab-order-collect-sample", args=[order1.id]),
                  {"sample_type": "SERUM"}, format="json")
    r2 = api.post(reverse("lab-order-collect-sample", args=[order2.id]),
                  {"sample_type": "URINE"}, format="json")
    assert r1.status_code == 200 and r2.status_code == 200

    id1 = r1.data["sample_collection"]["sample_id"]
    id2 = r2.data["sample_collection"]["sample_id"]
    today = timezone.now().strftime("%Y%m%d")
    assert id1 == f"LAB-{today}-0001"
    assert id2 == f"LAB-{today}-0002"


# --- collect-sample ------------------------------------------------------------
def test_collect_sample_requires_ordered_status(api, secretary, doctor_profile, treated):
    draft = _make_order(doctor_profile, treated, status=LabOrderStatus.DRAFT)
    api.force_authenticate(secretary)
    resp = api.post(reverse("lab-order-collect-sample", args=[draft.id]),
                    {"sample_type": "SERUM"}, format="json")
    assert resp.status_code == 400
    assert not SampleCollection.objects.filter(lab_order=draft).exists()


@pytest.mark.parametrize("role_fixture", ["doctor_profile_user", "patient_user"])
def test_collect_sample_forbidden_for_non_lab_staff(api, ordered_order, doctor_profile, treated, role_fixture):
    user = doctor_profile.user if role_fixture == "doctor_profile_user" else treated
    api.force_authenticate(user)
    resp = api.post(reverse("lab-order-collect-sample", args=[ordered_order.id]),
                    {"sample_type": "SERUM"}, format="json")
    assert resp.status_code == 403


def test_collect_sample_allowed_for_secretary_and_manager(api, ordered_order, secretary):
    api.force_authenticate(secretary)
    resp = api.post(reverse("lab-order-collect-sample", args=[ordered_order.id]),
                    {"sample_type": "SERUM", "notes": "hemolyzed risk"}, format="json")
    assert resp.status_code == 200
    assert resp.data["status"] == LabOrderStatus.SAMPLE_COLLECTED
    assert resp.data["sample_collected_at"] is not None
    sc = resp.data["sample_collection"]
    assert sc["sample_type"] == "SERUM"
    assert sc["notes"] == "hemolyzed risk"
    assert sc["collected_by_name"] == secretary.get_full_name()


def test_collect_sample_invalid_sample_type_rejected(api, ordered_order, secretary):
    api.force_authenticate(secretary)
    resp = api.post(reverse("lab-order-collect-sample", args=[ordered_order.id]),
                    {"sample_type": "NOT_A_TYPE"}, format="json")
    assert resp.status_code == 400


def test_collect_sample_stat_priority_skips_to_processing(api, secretary, doctor_profile, treated):
    """CW-6: STAT/URGENT orders auto-advance past SAMPLE_COLLECTED into PROCESSING."""
    stat_order = _make_order(doctor_profile, treated, priority=LabOrderPriority.STAT)
    api.force_authenticate(secretary)
    resp = api.post(reverse("lab-order-collect-sample", args=[stat_order.id]),
                    {"sample_type": "SERUM"}, format="json")
    assert resp.status_code == 200
    assert resp.data["status"] == LabOrderStatus.PROCESSING

    # send-to-lab is now a no-op path: the order already skipped SAMPLE_COLLECTED.
    send_resp = api.patch(reverse("lab-order-send-to-lab", args=[stat_order.id]))
    assert send_resp.status_code == 400

    # receive-at-lab still succeeds from PROCESSING, even though sent_to_lab_at
    # was never set -- the chain-of-custody record ends up with a gap.
    recv_resp = api.patch(reverse("lab-order-receive-at-lab", args=[stat_order.id]))
    assert recv_resp.status_code == 200
    sc = recv_resp.data["sample_collection"]
    assert sc["received_at_lab"] is not None
    assert sc["sent_to_lab_at"] is None


# --- send-to-lab -----------------------------------------------------------------
def test_send_to_lab_requires_sample_collected_status(api, secretary, ordered_order):
    api.force_authenticate(secretary)
    resp = api.patch(reverse("lab-order-send-to-lab", args=[ordered_order.id]))
    assert resp.status_code == 400


def test_send_to_lab_forbidden_for_doctor_and_patient(api, collected_order, doctor_profile, treated):
    api.force_authenticate(doctor_profile.user)
    assert api.patch(reverse("lab-order-send-to-lab", args=[collected_order.id])).status_code == 403
    api.force_authenticate(treated)
    assert api.patch(reverse("lab-order-send-to-lab", args=[collected_order.id])).status_code == 403


def test_send_to_lab_success(api, secretary, collected_order):
    api.force_authenticate(secretary)
    resp = api.patch(reverse("lab-order-send-to-lab", args=[collected_order.id]))
    assert resp.status_code == 200
    assert resp.data["status"] == LabOrderStatus.PROCESSING
    assert resp.data["sample_collection"]["sent_to_lab_at"] is not None


def test_send_to_lab_without_sample_collection_row_guarded(doctor_profile, treated):
    """Defensive branch in the service layer: SAMPLE_COLLECTED status with no
    SampleCollection row (should never happen via the API, but guard it)."""
    order = _make_order(doctor_profile, treated, status=LabOrderStatus.SAMPLE_COLLECTED)
    with pytest.raises(ValidationError):
        lab_order_service.send_to_lab(order)


# --- receive-at-lab ---------------------------------------------------------------
def test_receive_at_lab_requires_processing_status(api, secretary, collected_order):
    api.force_authenticate(secretary)
    resp = api.patch(reverse("lab-order-receive-at-lab", args=[collected_order.id]))
    assert resp.status_code == 400


def test_receive_at_lab_forbidden_for_doctor_and_patient(api, processing_order, doctor_profile, treated):
    api.force_authenticate(doctor_profile.user)
    assert api.patch(reverse("lab-order-receive-at-lab", args=[processing_order.id])).status_code == 403
    api.force_authenticate(treated)
    assert api.patch(reverse("lab-order-receive-at-lab", args=[processing_order.id])).status_code == 403


def test_receive_at_lab_success(api, secretary, processing_order):
    api.force_authenticate(secretary)
    resp = api.patch(reverse("lab-order-receive-at-lab", args=[processing_order.id]))
    assert resp.status_code == 200
    assert resp.data["sample_collection"]["received_at_lab"] is not None


def test_receive_at_lab_double_call_rejected(api, secretary, processing_order):
    api.force_authenticate(secretary)
    first = api.patch(reverse("lab-order-receive-at-lab", args=[processing_order.id]))
    assert first.status_code == 200
    second = api.patch(reverse("lab-order-receive-at-lab", args=[processing_order.id]))
    assert second.status_code == 400


def test_manager_can_perform_all_transitions(api, manager, doctor_profile, treated):
    order = _make_order(doctor_profile, treated)
    api.force_authenticate(manager)
    assert api.post(reverse("lab-order-collect-sample", args=[order.id]),
                    {"sample_type": "SERUM"}, format="json").status_code == 200
    assert api.patch(reverse("lab-order-send-to-lab", args=[order.id])).status_code == 200
    assert api.patch(reverse("lab-order-receive-at-lab", args=[order.id])).status_code == 200


# --- GET .../sample/ ---------------------------------------------------------------
def test_get_sample_returns_details(api, secretary, collected_order):
    api.force_authenticate(secretary)
    resp = api.get(reverse("lab-order-get-sample", args=[collected_order.id]))
    assert resp.status_code == 200
    assert resp.data["sample_id"].startswith("LAB-")
    assert resp.data["sample_type"] == "SERUM"


def test_get_sample_missing_returns_400(api, secretary, ordered_order):
    api.force_authenticate(secretary)
    resp = api.get(reverse("lab-order-get-sample", args=[ordered_order.id]))
    assert resp.status_code == 400


def test_get_sample_patient_scoping(api, treated, collected_order, patient2):
    # Owning patient can read their own sample.
    api.force_authenticate(treated)
    assert api.get(reverse("lab-order-get-sample", args=[collected_order.id])).status_code == 200
    # An unrelated patient can't even see the order exists.
    api.force_authenticate(patient2)
    assert api.get(reverse("lab-order-get-sample", args=[collected_order.id])).status_code == 404


# --- GET .../sample/label/ ----------------------------------------------------------
def test_sample_label_html_contains_expected_fields(api, secretary, collected_order, treated):
    api.force_authenticate(secretary)
    resp = api.get(reverse("lab-order-sample-label", args=[collected_order.id]))
    assert resp.status_code == 200
    assert resp["Content-Type"] == "text/html"
    body = resp.content.decode()
    sample = collected_order.sample_collection
    assert sample.sample_id in body
    assert treated.get_full_name() in body
    assert "CBC" in body
    assert collected_order.order_number in body


def test_sample_label_missing_sample_returns_400(api, secretary, ordered_order):
    api.force_authenticate(secretary)
    resp = api.get(reverse("lab-order-sample-label", args=[ordered_order.id]))
    assert resp.status_code == 400


def test_sample_label_escapes_patient_name(api, secretary, doctor_profile, make_user):
    """The label is built via server-side HTML string interpolation; a patient
    name containing markup must not be emitted unescaped (stored XSS risk since
    the label is opened directly as an HTML document by the secretary)."""
    evil = make_user(
        "evil@test.dev", RoleChoices.PATIENT,
        first_name="<script>alert(1)</script>", last_name="Evil",
    )
    DoctorPatient.objects.create(doctor=doctor_profile, patient=evil.patient_profile)
    order = _make_order(doctor_profile, evil)
    api.force_authenticate(secretary)
    api.post(reverse("lab-order-collect-sample", args=[order.id]),
             {"sample_type": "SERUM"}, format="json")

    resp = api.get(reverse("lab-order-sample-label", args=[order.id]))
    body = resp.content.decode()
    assert "<script>alert(1)</script>" not in body
