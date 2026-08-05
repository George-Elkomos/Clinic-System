"""Phase 16 — Advanced Analytics tests.

Covers the 2 genuinely new endpoints (specialty-analytics, lab-analytics),
the extended diagnosis-distribution (limit/year), and the billing-summary
alias, plus the shared manager-only permission gate and the new
AuditAction.ACCESS logging convention.
"""
from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.appointments.models import Appointment
from apps.audit.models import AuditLog
from apps.billing.models import Invoice
from apps.core.enums import (
    AppointmentStatus,
    AuditAction,
    InvoiceStatus,
    LabOrderStatus,
    RoleChoices,
)
from apps.doctors.models import DoctorProfile, Specialty, SpecialtyCategory
from apps.encounters.models import Diagnosis, DiagnosisCategory, Encounter, EncounterStatus
from apps.medical_records.models import LabOrder, LabOrderItem, LabOrderResult

pytestmark = pytest.mark.django_db


@pytest.fixture
def manager(make_user):
    return make_user("analytics-mgr@test.dev", RoleChoices.MANAGER)


@pytest.fixture
def specialty_a(db):
    cat = SpecialtyCategory.objects.create(name="Analytics Cardiology Cat")
    return Specialty.objects.create(name="Analytics Cardiology", name_ar="قلب", category=cat)


@pytest.fixture
def specialty_b(db):
    cat = SpecialtyCategory.objects.create(name="Analytics Derma Cat")
    return Specialty.objects.create(name="Analytics Dermatology", name_ar="جلدية", category=cat)


def _make_appointment(patient, doctor_profile, status, scheduled_start, checked_in_at=None, started_at=None):
    return Appointment.objects.create(
        patient=patient.patient_profile, doctor=doctor_profile,
        scheduled_start=scheduled_start, scheduled_end=scheduled_start + timedelta(minutes=30),
        status=status, checked_in_at=checked_in_at, started_at=started_at,
    )


# --------------------------------------------------------------------------
# Permissions — manager only, 403 for everyone else, across all 4 endpoints.
# --------------------------------------------------------------------------

ANALYTICS_ENDPOINTS = [
    "reports-specialty-analytics",
    "reports-lab-analytics",
    "reports-diagnosis-distribution",
    "reports-billing-summary",
]


class TestPermissions:
    @pytest.mark.parametrize("url_name", ANALYTICS_ENDPOINTS)
    def test_manager_allowed(self, api, manager, url_name):
        api.force_authenticate(manager)
        assert api.get(reverse(url_name)).status_code == 200

    @pytest.mark.parametrize("url_name", ANALYTICS_ENDPOINTS)
    def test_non_managers_forbidden(self, api, url_name, patient, secretary, doctor_profile):
        for user in (patient, secretary, doctor_profile.user):
            api.force_authenticate(user)
            assert api.get(reverse(url_name)).status_code == 403


# --------------------------------------------------------------------------
# Specialty analytics
# --------------------------------------------------------------------------

class TestSpecialtyAnalytics:
    def test_totals_completion_and_wait(self, api, manager, patient, patient2, doctor_profile, specialty_a):
        doctor_profile.specialties.add(specialty_a)
        now = timezone.now()
        _make_appointment(
            patient, doctor_profile, AppointmentStatus.COMPLETED, now,
            checked_in_at=now, started_at=now + timedelta(minutes=10),
        )
        _make_appointment(
            patient2, doctor_profile, AppointmentStatus.COMPLETED, now,
            checked_in_at=now, started_at=now + timedelta(minutes=20),
        )
        _make_appointment(patient, doctor_profile, AppointmentStatus.NO_SHOW, now)

        api.force_authenticate(manager)
        resp = api.get(reverse("reports-specialty-analytics"), {"period": "month"})
        assert resp.status_code == 200
        row = next(r for r in resp.data["specialties"] if r["specialty_id"] == specialty_a.id)
        assert row["total_appointments"] == 3
        assert row["completed"] == 2
        assert row["completion_rate"] == round(2 / 3 * 100, 1)
        assert row["avg_wait_minutes"] == 15.0  # (10 + 20) / 2

    def test_multi_specialty_doctor_fans_out(self, api, manager, patient, doctor_profile, specialty_a, specialty_b):
        doctor_profile.specialties.add(specialty_a, specialty_b)
        now = timezone.now()
        _make_appointment(patient, doctor_profile, AppointmentStatus.COMPLETED, now)

        api.force_authenticate(manager)
        resp = api.get(reverse("reports-specialty-analytics"), {"period": "month"})
        by_id = {r["specialty_id"]: r for r in resp.data["specialties"]}
        assert specialty_a.id in by_id and specialty_b.id in by_id
        assert by_id[specialty_a.id]["total_appointments"] == 1
        assert by_id[specialty_b.id]["total_appointments"] == 1

    def test_zero_specialty_doctor_excluded(self, api, manager, make_user, patient):
        doc_user = make_user("nospec-doc@test.dev", RoleChoices.DOCTOR)
        doc_profile = DoctorProfile.objects.create(user=doc_user, license_number="LIC-NOSPEC")
        assert doc_profile.specialties.count() == 0
        _make_appointment(patient, doc_profile, AppointmentStatus.COMPLETED, timezone.now())

        api.force_authenticate(manager)
        resp = api.get(reverse("reports-specialty-analytics"), {"period": "month"})
        assert resp.data["specialties"] == []

    def test_monthly_trend_independent_of_period(self, api, manager, patient, doctor_profile, specialty_a):
        doctor_profile.specialties.add(specialty_a)
        now = timezone.now()
        this_month = now.replace(day=1) + timedelta(days=9)
        prev_month_anchor = now.replace(day=1) - timedelta(days=1)
        last_month = prev_month_anchor.replace(day=min(9, prev_month_anchor.day))
        _make_appointment(patient, doctor_profile, AppointmentStatus.COMPLETED, this_month)
        _make_appointment(patient, doctor_profile, AppointmentStatus.COMPLETED, last_month)

        api.force_authenticate(manager)
        # period=week only affects `specialties`, not the fixed 6-month `monthly_trend`.
        resp = api.get(reverse("reports-specialty-analytics"), {"period": "week"})
        months = {
            row["month"] for row in resp.data["monthly_trend"] if row["specialty_id"] == specialty_a.id
        }
        assert this_month.strftime("%Y-%m") in months
        assert last_month.strftime("%Y-%m") in months


# --------------------------------------------------------------------------
# Lab analytics
# --------------------------------------------------------------------------

class TestLabAnalytics:
    def test_counts_turnaround_and_abnormal_pct(self, api, manager, patient, doctor_profile):
        now = timezone.now()
        order = LabOrder.objects.create(
            patient=patient.patient_profile, doctor=doctor_profile,
            status=LabOrderStatus.COMPLETED,
            ordered_at=now - timedelta(hours=10), completed_at=now,
        )
        item1 = LabOrderItem.objects.create(order=order, test_name="CBC")
        item2 = LabOrderItem.objects.create(order=order, test_name="Lipid Panel")
        LabOrderResult.objects.create(
            order=order, order_item=item1, test_name="CBC", result_value="ok",
            is_abnormal=False, result_date=now.date(),
        )
        LabOrderResult.objects.create(
            order=order, order_item=item2, test_name="Lipid Panel", result_value="high",
            is_abnormal=True, result_date=now.date(),
        )

        api.force_authenticate(manager)
        resp = api.get(reverse("reports-lab-analytics"), {"period": "month"})
        assert resp.status_code == 200
        assert resp.data["total_lab_orders"] == 1
        assert resp.data["overall_avg_turnaround_hours"] == 10.0
        cbc = next(t for t in resp.data["tests"] if t["test_name"] == "CBC")
        assert cbc["count"] == 1
        assert cbc["avg_turnaround_hours"] == 10.0
        assert cbc["abnormal_pct"] == 0.0
        lipid = next(t for t in resp.data["tests"] if t["test_name"] == "Lipid Panel")
        assert lipid["abnormal_pct"] == 100.0
        assert resp.data["abnormal_result_pct"] == 50.0

    def test_order_with_no_results_yet(self, api, manager, patient, doctor_profile):
        order = LabOrder.objects.create(
            patient=patient.patient_profile, doctor=doctor_profile,
            status=LabOrderStatus.PROCESSING, ordered_at=timezone.now(),
        )
        LabOrderItem.objects.create(order=order, test_name="HbA1c")

        api.force_authenticate(manager)
        resp = api.get(reverse("reports-lab-analytics"), {"period": "month"})
        row = next(t for t in resp.data["tests"] if t["test_name"] == "HbA1c")
        assert row["avg_turnaround_hours"] is None
        assert row["results_count"] == 0
        assert resp.data["overall_avg_turnaround_hours"] is None

    def test_case_mismatched_result_name_joins_its_items_bucket(self, api, manager, patient, doctor_profile):
        """LabOrderResult.test_name is an independent free-text field from
        LabOrderItem.test_name (order_item is a nullable FK and isn't always
        set) — real production data showed an item ordered as "CBC" with its
        own result entered as "cbc" (order_item left null). Grouping each
        side by its raw string split one test's turnaround data from its
        abnormal-rate data into two rows: "CBC" showed a real turnaround but
        an incomplete abnormal count, and a phantom "cbc" row showed
        avg_turnaround_hours=None next to abnormal_pct=100 — the same
        contradiction reported for the REVIEWED-status bug, from a different
        cause. Case/whitespace differences must not fragment one test into two."""
        now = timezone.now()
        order = LabOrder.objects.create(
            patient=patient.patient_profile, doctor=doctor_profile,
            status=LabOrderStatus.COMPLETED,
            ordered_at=now - timedelta(hours=8), completed_at=now,
        )
        LabOrderItem.objects.create(order=order, test_name="CBC")
        LabOrderResult.objects.create(
            order=order, order_item=None, test_name="cbc", result_value="low",
            is_abnormal=True, result_date=now.date(),
        )

        api.force_authenticate(manager)
        resp = api.get(reverse("reports-lab-analytics"), {"period": "month"})
        matches = [t for t in resp.data["tests"] if t["test_name"].strip().casefold() == "cbc"]
        assert len(matches) == 1, "case-mismatched item/result must merge into a single row, not two"
        row = matches[0]
        assert row["avg_turnaround_hours"] == 8.0
        assert row["abnormal_pct"] == 100.0

    def test_reviewed_order_still_counts_toward_turnaround(self, api, manager, patient, doctor_profile):
        """A lab order that has progressed past COMPLETED to REVIEWED (the
        doctor has signed off on the results) must still contribute to
        avg_turnaround_hours. completed_at is set once when the order is
        completed and is never cleared on review (see
        apps/medical_records/services/lab_orders.py:review_order), so
        filtering the turnaround calc on status == COMPLETED wrongly dropped
        every reviewed order while abnormal_pct (no such status filter) kept
        counting its results — producing a contradictory row where
        avg_turnaround_hours was None but abnormal_pct was > 0."""
        now = timezone.now()
        order = LabOrder.objects.create(
            patient=patient.patient_profile, doctor=doctor_profile,
            status=LabOrderStatus.REVIEWED,
            ordered_at=now - timedelta(hours=6), completed_at=now, reviewed_at=now,
        )
        item = LabOrderItem.objects.create(order=order, test_name="HbA1c")
        LabOrderResult.objects.create(
            order=order, order_item=item, test_name="HbA1c", result_value="high",
            is_abnormal=True, result_date=now.date(),
        )

        api.force_authenticate(manager)
        resp = api.get(reverse("reports-lab-analytics"), {"period": "month"})
        row = next(t for t in resp.data["tests"] if t["test_name"] == "HbA1c")
        assert row["avg_turnaround_hours"] == 6.0
        assert row["abnormal_pct"] == 100.0
        assert resp.data["overall_avg_turnaround_hours"] == 6.0

    def test_empty_period_no_errors(self, api, manager):
        api.force_authenticate(manager)
        resp = api.get(reverse("reports-lab-analytics"), {"period": "week"})
        assert resp.status_code == 200
        assert resp.data["tests"] == []
        assert resp.data["total_lab_orders"] == 0
        assert resp.data["abnormal_result_pct"] == 0.0


# --------------------------------------------------------------------------
# Diagnosis distribution — extended (limit, year period), regression-guarded.
# --------------------------------------------------------------------------

class TestDiagnosisDistributionExtension:
    def test_default_limit_is_20(self, api, manager, patient, doctor_profile):
        cat = DiagnosisCategory.objects.create(name="Cat-Limit20")
        for i in range(25):
            diag = Diagnosis.objects.create(name=f"Dx{i}", category_ref=cat)
            Encounter.objects.create(
                patient=patient.patient_profile, doctor=doctor_profile,
                status=EncounterStatus.SUBMITTED, is_current=True, diagnosis=diag,
            )
        api.force_authenticate(manager)
        resp = api.get(reverse("reports-diagnosis-distribution"), {"period": "all"})
        assert resp.data["limit"] == 20
        assert len(resp.data["diagnoses"]) == 20

    def test_limit_override(self, api, manager, patient, doctor_profile):
        cat = DiagnosisCategory.objects.create(name="Cat-LimitOverride")
        for i in range(10):
            diag = Diagnosis.objects.create(name=f"Dy{i}", category_ref=cat)
            Encounter.objects.create(
                patient=patient.patient_profile, doctor=doctor_profile,
                status=EncounterStatus.SUBMITTED, is_current=True, diagnosis=diag,
            )
        api.force_authenticate(manager)
        resp = api.get(reverse("reports-diagnosis-distribution"), {"period": "all", "limit": 5})
        assert len(resp.data["diagnoses"]) == 5

    def test_year_period_uses_calendar_boundary(self, api, manager, patient, doctor_profile):
        cat = DiagnosisCategory.objects.create(name="Cat-Year")
        old_diag = Diagnosis.objects.create(name="OldDx", category_ref=cat)
        old_enc = Encounter.objects.create(
            patient=patient.patient_profile, doctor=doctor_profile,
            status=EncounterStatus.SUBMITTED, is_current=True, diagnosis=old_diag,
        )
        last_year_dec_31 = date(timezone.localdate().year - 1, 12, 31)
        Encounter.objects.filter(pk=old_enc.pk).update(created_at=last_year_dec_31)

        api.force_authenticate(manager)
        resp_year = api.get(reverse("reports-diagnosis-distribution"), {"period": "year"})
        assert "OldDx" not in {d["name"] for d in resp_year.data["diagnoses"]}

        # Under the old, unchanged rolling "all" period, it still shows up.
        resp_all = api.get(reverse("reports-diagnosis-distribution"), {"period": "all"})
        assert "OldDx" in {d["name"] for d in resp_all.data["diagnoses"]}

    def test_week_month_all_unchanged(self, api, manager, patient, doctor_profile):
        cat = DiagnosisCategory.objects.create(name="Cat-Regression")
        diag = Diagnosis.objects.create(name="RecentDx", category_ref=cat)
        Encounter.objects.create(
            patient=patient.patient_profile, doctor=doctor_profile,
            status=EncounterStatus.SUBMITTED, is_current=True, diagnosis=diag,
        )
        api.force_authenticate(manager)
        for period in ("week", "month", "all"):
            resp = api.get(reverse("reports-diagnosis-distribution"), {"period": period})
            assert resp.status_code == 200
            assert any(d["name"] == "RecentDx" for d in resp.data["diagnoses"])


# --------------------------------------------------------------------------
# Billing summary alias — same aggregation as the pre-existing /reports/billing/.
# --------------------------------------------------------------------------

class TestBillingSummaryAlias:
    def test_matches_reports_billing(self, api, manager, patient, doctor_profile):
        Invoice.objects.create(
            patient=patient, doctor=doctor_profile.user,
            due_date=timezone.localdate() + timedelta(days=7),
            status=InvoiceStatus.ISSUED, subtotal=Decimal("100.00"), total=Decimal("100.00"),
        )
        api.force_authenticate(manager)
        summary = api.get(reverse("reports-billing-summary"), {"period": "month"}).data
        billing = api.get(reverse("reports-billing"), {"period": "month"}).data
        assert summary["total_billed"] == billing["total_billed"] == Decimal("100.00")
        assert summary["revenue_by_doctor"] == billing["revenue_by_doctor"]

    def test_existing_billing_endpoint_unaffected(self, api, manager):
        api.force_authenticate(manager)
        assert api.get(reverse("reports-billing"), {"period": "month"}).status_code == 200


# --------------------------------------------------------------------------
# Audit convention — first real usage of AuditAction.ACCESS.
# --------------------------------------------------------------------------

class TestAuditAccessLogging:
    def test_access_logged_for_new_endpoints(self, api, manager):
        api.force_authenticate(manager)
        api.get(reverse("reports-specialty-analytics"))
        assert AuditLog.objects.filter(action=AuditAction.ACCESS).exists()
