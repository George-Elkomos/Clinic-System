"""Phase 4 verification: reviews + moderation, follow-up scheduling, reports."""
import pytest
from django.urls import reverse
from django.utils import timezone

from apps.appointments import services
from apps.core.enums import AppointmentStatus, AppointmentType, FollowUpStatus, NotificationVerb, RoleChoices
from apps.notifications.models import Notification
from apps.reviews.models import Review

pytestmark = pytest.mark.django_db


def _completed_appt(patient, doctor_profile, future_slot):
    appt = services.book_slot(patient=patient.patient_profile, slot_id=future_slot.pk)
    services.complete_appointment(appt)
    return appt


# --- Reviews ----------------------------------------------------------------
def test_patient_reviews_completed_visit(api, patient, doctor_profile, future_slot):
    appt = _completed_appt(patient, doctor_profile, future_slot)
    api.force_authenticate(patient)
    resp = api.post(reverse("review-list"), {"appointment": appt.id, "rating": 5, "comment": "Great"}, format="json")
    assert resp.status_code == 201
    # Duplicate rejected.
    dup = api.post(reverse("review-list"), {"appointment": appt.id, "rating": 4}, format="json")
    assert dup.status_code == 400


def test_cannot_review_incomplete_appt(api, patient, doctor_profile, future_slot):
    appt = services.book_slot(patient=patient.patient_profile, slot_id=future_slot.pk)  # PENDING
    api.force_authenticate(patient)
    resp = api.post(reverse("review-list"), {"appointment": appt.id, "rating": 5}, format="json")
    assert resp.status_code == 400


def test_completion_emits_review_notification(patient, doctor_profile, future_slot):
    _completed_appt(patient, doctor_profile, future_slot)
    assert Notification.objects.filter(recipient=patient, verb=NotificationVerb.REVIEW).count() == 1


def test_doctor_reads_reviews_secretary_forbidden(api, patient, doctor_profile, future_slot, secretary):
    appt = _completed_appt(patient, doctor_profile, future_slot)
    Review.objects.create(patient=patient.patient_profile, doctor=doctor_profile, appointment=appt, rating=4, comment="ok")
    api.force_authenticate(doctor_profile.user)
    r = api.get(reverse("review-list"))
    assert r.status_code == 200 and r.data["count"] == 1
    assert r.data["results"][0]["comment"] == "ok"
    api.force_authenticate(secretary)
    assert api.get(reverse("review-list")).status_code == 403


def test_manager_hide_removes_from_public_aggregate(api, patient, doctor_profile, future_slot, make_user):
    appt = _completed_appt(patient, doctor_profile, future_slot)
    review = Review.objects.create(patient=patient.patient_profile, doctor=doctor_profile, appointment=appt, rating=5)
    manager = make_user("mgr4@test.dev", RoleChoices.MANAGER)

    pub = api.get(reverse("public-doctor-detail", args=[doctor_profile.id]))
    assert pub.data["average_rating"] == 5.0 and pub.data["review_count"] == 1

    api.force_authenticate(manager)
    assert api.post(reverse("review-hide", args=[review.id]), {"reason": "spam"}, format="json").status_code == 200

    pub2 = api.get(reverse("public-doctor-detail", args=[doctor_profile.id]))
    assert pub2.data["review_count"] == 0


# --- Follow-ups -------------------------------------------------------------
def test_create_and_confirm_followup(api, patient, doctor_profile, future_slot):
    appt = _completed_appt(patient, doctor_profile, future_slot)
    today = timezone.localdate()

    api.force_authenticate(doctor_profile.user)
    created = api.post(reverse("followup-list"),
                       {"origin_appointment": appt.id, "recommended_date": today.isoformat(), "notes": "recheck"},
                       format="json")
    assert created.status_code == 201
    assert created.data["status"] == FollowUpStatus.SUGGESTED
    assert created.data["suggested_slot"] is not None  # a future slot was found
    fid = created.data["id"]
    assert Notification.objects.filter(recipient=patient, verb=NotificationVerb.FOLLOWUP).exists()

    # Patient confirms -> a FOLLOW_UP appointment is booked.
    api.force_authenticate(patient)
    confirmed = api.post(reverse("followup-confirm", args=[fid]), {}, format="json")
    assert confirmed.status_code == 201
    assert confirmed.data["appointment_type"] == AppointmentType.FOLLOW_UP


def test_stale_followup_reslotted_on_list(api, patient, doctor_profile, future_slot):
    """A SUGGESTED follow-up whose slot went stale is re-pointed to the next
    open slot when the patient loads their follow-up list — no dead-ends."""
    from datetime import timedelta

    from apps.core.enums import SlotStatus
    from apps.doctors.models import TimeSlot

    appt = _completed_appt(patient, doctor_profile, future_slot)
    followup = services.create_followup(
        origin_appointment=appt, recommended_date=timezone.localdate()
    )
    original_slot = followup.suggested_slot
    assert original_slot is not None

    # Make the pinned slot unbookable (someone else took it).
    original_slot.status = SlotStatus.BOOKED
    original_slot.save(update_fields=["status"])
    # Guarantee another open future slot exists to move to.
    assert TimeSlot.objects.filter(
        doctor=doctor_profile, status=SlotStatus.AVAILABLE,
        start_datetime__gte=timezone.now() + timedelta(minutes=30),
    ).exists()

    api.force_authenticate(patient)
    resp = api.get(reverse("followup-list"))
    assert resp.status_code == 200
    row = next(r for r in resp.data["results"] if r["id"] == followup.id)
    assert row["suggested_slot"] is not None
    assert row["suggested_slot"] != original_slot.id  # re-slotted

    followup.refresh_from_db()
    assert followup.suggested_slot.status == SlotStatus.AVAILABLE
    assert followup.suggested_slot.start_datetime >= timezone.now()


def test_confirm_rejects_past_slot(api, patient, doctor_profile, future_slot):
    """Confirming a follow-up whose slot is in the past fails with a clear,
    specific message (not the generic form-validation copy)."""
    from datetime import timedelta

    from apps.core.enums import SlotStatus
    from apps.doctors.models import TimeSlot

    appt = _completed_appt(patient, doctor_profile, future_slot)
    followup = services.create_followup(
        origin_appointment=appt, recommended_date=timezone.localdate()
    )
    # Force a past slot onto the follow-up.
    past = timezone.now() - timedelta(days=30)
    past_slot = TimeSlot.objects.create(
        doctor=doctor_profile, date=past.date(),
        start_datetime=past, end_datetime=past + timedelta(minutes=30),
        status=SlotStatus.AVAILABLE,
    )
    followup.suggested_slot = past_slot
    followup.save(update_fields=["suggested_slot"])

    api.force_authenticate(patient)
    resp = api.post(reverse("followup-confirm", args=[followup.id]), {}, format="json")
    assert resp.status_code == 400
    assert "passed" in str(resp.data["fields"]).lower()


# --- Reports ----------------------------------------------------------------
def test_reports_manager_only(api, patient, make_user):
    manager = make_user("mgr5@test.dev", RoleChoices.MANAGER)
    api.force_authenticate(patient)
    assert api.get(reverse("reports-dashboard")).status_code == 403
    api.force_authenticate(manager)
    assert api.get(reverse("reports-dashboard")).status_code == 200


def test_report_metrics(api, patient, patient2, doctor_profile, future_slot, make_user):
    # One completed, one no-show for the doctor.
    _completed_appt(patient, doctor_profile, future_slot)
    no_show = services.create_walk_in(patient=patient2.patient_profile, doctor=doctor_profile, created_by=None)
    no_show.status = AppointmentStatus.NO_SHOW
    no_show.save(update_fields=["status"])

    manager = make_user("mgr6@test.dev", RoleChoices.MANAGER)
    api.force_authenticate(manager)
    data = api.get(reverse("reports-dashboard"), {"period": "all"}).data
    doc_row = next(r for r in data["appointments_per_doctor"] if r["doctor_id"] == doctor_profile.id)
    assert doc_row["completed"] >= 1 and doc_row["no_show"] >= 1
    assert data["overall"]["total"] >= 2


def test_report_export_formats(api, make_user):
    manager = make_user("mgr7@test.dev", RoleChoices.MANAGER)
    api.force_authenticate(manager)
    pdf = api.get(reverse("reports-export"), {"fmt": "pdf", "period": "all"})
    assert pdf.status_code == 200 and pdf["Content-Type"] == "application/pdf"
    csv_resp = api.get(reverse("reports-export"), {"fmt": "csv", "period": "all"})
    assert csv_resp.status_code == 200 and "text/csv" in csv_resp["Content-Type"]
