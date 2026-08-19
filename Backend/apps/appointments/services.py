"""Booking lifecycle services. All slot mutations run under select_for_update
inside a transaction so concurrent bookings can never double-allocate a slot."""
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.core.enums import (
    AppointmentStatus,
    AppointmentType,
    NotificationVerb,
    SlotStatus,
)
from apps.core.text import bidi_name, doctor_display_name, format_when_bilingual
from apps.doctors.models import TimeSlot

from .models import Appointment


@transaction.atomic
def book_slot(*, patient, slot_id, reason="", created_by=None,
              appointment_type=AppointmentType.SCHEDULED,
              staff_override=False, override_reason="", bypass_accepting_gate=False):
    """Book an AVAILABLE slot -> a PENDING appointment. Concurrency-safe.

    `bypass_accepting_gate` is for callers where is_accepting_patients simply
    doesn't apply (e.g. confirming a follow-up the doctor themselves already
    recommended to an existing patient) -- it skips the gate silently, no
    override flag recorded. `staff_override` is the front-desk's explicit
    "book anyway" after being warned -- it's the only way past the gate for
    everyone else, and it's recorded on the appointment for audit.
    """
    try:
        slot = TimeSlot.objects.select_for_update().get(pk=slot_id)
    except TimeSlot.DoesNotExist:
        raise ValidationError({"slot": "That time slot no longer exists."})

    if slot.status != SlotStatus.AVAILABLE or slot.start_datetime < timezone.now():
        # The belt-and-suspenders DB constraints back this check up.
        raise ValidationError(
            {"slot": "Sorry, that time was just taken. Please pick another time."}
        )

    is_manual_override = False
    if not slot.doctor.is_accepting_patients and not bypass_accepting_gate:
        if not staff_override:
            raise ValidationError({
                "doctor": f"{slot.doctor} is not currently accepting new appointments."
            })
        is_manual_override = True

    slot.status = SlotStatus.BOOKED
    slot.save(update_fields=["status"])

    return Appointment.objects.create(
        patient=patient,
        doctor=slot.doctor,
        time_slot=slot,
        scheduled_start=slot.start_datetime,
        scheduled_end=slot.end_datetime,
        status=AppointmentStatus.PENDING,
        appointment_type=appointment_type,
        reason=reason,
        created_by=created_by,
        is_manual_override=is_manual_override,
        override_reason=override_reason if is_manual_override else "",
    )


@transaction.atomic
def confirm_appointment(appointment):
    if appointment.status != AppointmentStatus.PENDING:
        raise ValidationError(
            {"status": "Only a pending appointment can be confirmed."}
        )
    appointment.status = AppointmentStatus.CONFIRMED
    appointment.save(update_fields=["status", "updated_at"])
    return appointment


@transaction.atomic
def cancel_appointment(appointment, *, cancelled_by, reason="", enforce_window=False):
    """Cancel an appointment and free its slot (kept BLOCKED-free for rebooking)."""
    if not appointment.is_active:
        raise ValidationError(
            {"status": "This appointment can no longer be cancelled."}
        )

    if enforce_window:
        window = timedelta(hours=settings.CANCELLATION_WINDOW_HOURS)
        if appointment.scheduled_start - timezone.now() < window:
            raise ValidationError(
                {"detail": (
                    f"Appointments can only be cancelled at least "
                    f"{settings.CANCELLATION_WINDOW_HOURS} hours in advance. "
                    f"Please call the clinic for help."
                )}
            )

    appointment.status = AppointmentStatus.CANCELLED
    appointment.cancellation_reason = reason
    appointment.cancelled_by = cancelled_by
    appointment.save(update_fields=[
        "status", "cancellation_reason", "cancelled_by", "updated_at",
    ])

    slot = appointment.time_slot
    if slot:
        slot = TimeSlot.objects.select_for_update().get(pk=slot.pk)
        slot.status = (
            SlotStatus.AVAILABLE
            if slot.start_datetime >= timezone.now()
            else SlotStatus.PAST
        )
        slot.save(update_fields=["status"])
        # Release the O2O link so the freed slot can be rebooked (the appointment
        # keeps its denormalized scheduled_start/end for the record).
        appointment.time_slot = None
        appointment.save(update_fields=["time_slot", "updated_at"])
        if slot.status == SlotStatus.AVAILABLE:
            notify_waitlist_for_slot(slot)

    return appointment


def _notify_secretaries(*, verb, title, body, title_ar="", body_ar="", related):
    """In-app-only alert to every active secretary. Never reaches the patient —
    these two sweeps are deliberately silent to the patient (see auto-cancel /
    reliability-score spec)."""
    from apps.core.enums import RoleChoices
    from apps.notifications.services import notify
    from apps.users.models import User

    for secretary in User.objects.filter(role=RoleChoices.SECRETARY, is_active=True):
        notify(
            recipient=secretary, verb=verb, title=title, body=body,
            title_ar=title_ar, body_ar=body_ar,
            related=related, channels=["in_app"],
        )


@transaction.atomic
def expire_pending_appointment(appointment):
    """A PENDING booking nobody confirmed before the grace window passed.
    Frees its slot (same as cancel_appointment) so it can be rebooked."""
    if appointment.status != AppointmentStatus.PENDING:
        return appointment

    appointment.status = AppointmentStatus.EXPIRED
    appointment.cancellation_reason = "Not confirmed before appointment time."
    appointment.save(update_fields=["status", "cancellation_reason", "updated_at"])

    slot = appointment.time_slot
    if slot:
        slot = TimeSlot.objects.select_for_update().get(pk=slot.pk)
        slot.status = (
            SlotStatus.AVAILABLE
            if slot.start_datetime >= timezone.now()
            else SlotStatus.PAST
        )
        slot.save(update_fields=["status"])
        appointment.time_slot = None
        appointment.save(update_fields=["time_slot", "updated_at"])
        if slot.status == SlotStatus.AVAILABLE:
            notify_waitlist_for_slot(slot)

    return appointment


def expire_due_appointments(now=None):
    """Sweep: PENDING appointments still unconfirmed PENDING_EXPIRY_GRACE_MINUTES
    past their scheduled_start. Meant to run periodically (management command),
    not on-request. Silent to the patient; logs an in-app alert for the desk."""
    now = now or timezone.now()
    cutoff = now - timedelta(minutes=settings.PENDING_EXPIRY_GRACE_MINUTES)
    qs = Appointment.objects.select_related("patient__user", "doctor__user").filter(
        status=AppointmentStatus.PENDING, scheduled_start__lte=cutoff,
    )
    count = 0
    for appt in qs:
        expire_pending_appointment(appt)
        when, when_ar = format_when_bilingual(appt.scheduled_start)
        _notify_secretaries(
            verb=NotificationVerb.APPT_EXPIRED,
            title="Booking expired",
            title_ar="انتهت صلاحية الحجز",
            body=(
                f"{appt.patient.user.get_full_name()}'s booking with {appt.doctor} on "
                f"{when} expired unconfirmed."
            ),
            body_ar=(
                f"انتهت صلاحية حجز {bidi_name(appt.patient.user)} مع "
                f"{doctor_display_name(appt.doctor, arabic=True)} في {when_ar} دون تأكيد."
            ),
            related=appt,
        )
        count += 1
    return count


@transaction.atomic
def mark_no_show(appointment):
    """Shared by the manual staff action and the automated overdue sweep."""
    active = (
        AppointmentStatus.CONFIRMED, AppointmentStatus.CHECKED_IN, AppointmentStatus.IN_PROGRESS,
    )
    if appointment.status not in active:
        raise ValidationError({"detail": "Cannot mark as no-show from this status."})
    appointment.status = AppointmentStatus.NO_SHOW
    appointment.save(update_fields=["status", "updated_at"])
    return appointment


def mark_overdue_no_shows(now=None):
    """Sweep: CONFIRMED appointments (patient never checked in) past whichever
    comes first — scheduled_end, or NO_SHOW_GRACE_MINUTES after scheduled_start.
    Only CONFIRMED is auto-transitioned; CHECKED_IN/IN_PROGRESS mean the patient
    did show up, so those stay manual-only (see the `no-show` view action)."""
    now = now or timezone.now()
    candidates = Appointment.objects.select_related("patient__user", "doctor__user").filter(
        status=AppointmentStatus.CONFIRMED, scheduled_start__lte=now,
    )
    count = 0
    for appt in candidates:
        cutoff = min(
            appt.scheduled_end, appt.scheduled_start + timedelta(minutes=settings.NO_SHOW_GRACE_MINUTES),
        )
        if now < cutoff:
            continue
        mark_no_show(appt)
        when, when_ar = format_when_bilingual(appt.scheduled_start)
        _notify_secretaries(
            verb=NotificationVerb.APPT_NO_SHOW,
            title="Patient marked no-show",
            title_ar="تم تسجيل غياب المريض",
            body=(
                f"{appt.patient.user.get_full_name()} did not check in for their "
                f"{when} appointment with {appt.doctor}."
            ),
            body_ar=(
                f"لم يحضر {bidi_name(appt.patient.user)} لموعده مع "
                f"{doctor_display_name(appt.doctor, arabic=True)} في {when_ar}."
            ),
            related=appt,
        )
        count += 1
    return count


@transaction.atomic
def complete_appointment(appointment):
    """Mark completed, record the doctor↔patient link, and trigger billing.

    Billing (Phase 12) either consumes an active free-follow-up window or
    issues a consultation invoice — see billing.services for the rules.
    """
    from apps.billing.services import handle_appointment_completed
    from apps.core.enums import DoctorPatientSource
    from apps.doctors.models import DoctorPatient

    appointment.status = AppointmentStatus.COMPLETED
    appointment.completed_at = timezone.now()
    appointment.save(update_fields=["status", "completed_at", "updated_at"])

    link, _ = DoctorPatient.objects.get_or_create(
        doctor=appointment.doctor,
        patient=appointment.patient,
        defaults={"source": DoctorPatientSource.APPOINTMENT},
    )
    link.last_treated_at = appointment.completed_at
    link.save(update_fields=["last_treated_at", "updated_at"])

    invoice, fee_validity = handle_appointment_completed(appointment)
    # Exposed (not persisted) so the API layer can tell the front desk what
    # happened: "Invoice #INV-XXXX generated" vs "free follow-up used".
    appointment.billing_invoice = invoice
    appointment.billing_fee_validity = fee_validity
    return appointment


@transaction.atomic
def notify_waitlist_for_slot(slot):
    """When a slot frees up, notify the earliest matching waiting patient."""
    from apps.core.enums import NotificationVerb, WaitlistStatus
    from apps.notifications.services import notify

    from .models import WaitlistEntry

    entry = (
        WaitlistEntry.objects.select_for_update()
        .filter(
            doctor=slot.doctor,
            status=WaitlistStatus.WAITING,
            desired_date_from__lte=slot.date,
            desired_date_to__gte=slot.date,
        )
        .order_by("position", "created_at")
        .first()
    )
    if entry is None:
        return None

    now = timezone.now()
    entry.status = WaitlistStatus.NOTIFIED
    entry.notified_at = now
    entry.notify_expires_at = now + timedelta(hours=settings.WAITLIST_HOLD_HOURS)
    entry.save(update_fields=["status", "notified_at", "notify_expires_at", "updated_at"])

    when, when_ar = format_when_bilingual(slot.start_datetime)
    notify(
        recipient=entry.patient.user,
        verb=NotificationVerb.WAITLIST_OPEN,
        title="A slot just opened",
        title_ar="أصبح هناك موعد متاح",
        body=f"A time with {slot.doctor} on {when} is now available. Please book it soon.",
        body_ar=f"أصبح هناك موعد متاح مع {doctor_display_name(slot.doctor, arabic=True)} في {when_ar}. يرجى الحجز في أقرب وقت.",
        related=entry,
    )
    return entry


@transaction.atomic
def create_walk_in(*, patient, doctor, reason="", created_by=None, emergency=False,
                    staff_override=False, override_reason=""):
    """Add a walk-in (or emergency) patient straight into the doctor's queue."""
    from apps.core.enums import DoctorPatientSource
    from apps.doctors.models import DoctorPatient

    is_manual_override = False
    if not doctor.accepts_walk_ins:
        if not staff_override:
            raise ValidationError({
                "doctor": f"{doctor} does not currently accept walk-ins."
            })
        is_manual_override = True

    now = timezone.now()
    duration = timedelta(minutes=doctor.avg_appointment_duration or 15)
    appointment = Appointment.objects.create(
        patient=patient,
        doctor=doctor,
        time_slot=None,
        scheduled_start=now,
        scheduled_end=now + duration,
        status=AppointmentStatus.CHECKED_IN,  # enters the live queue immediately
        appointment_type=(AppointmentType.EMERGENCY if emergency else AppointmentType.WALK_IN),
        priority=10 if emergency else 0,
        reason=reason,
        created_by=created_by,
        checked_in_at=now,
        is_manual_override=is_manual_override,
        override_reason=override_reason if is_manual_override else "",
    )
    link, _ = DoctorPatient.objects.get_or_create(
        doctor=doctor, patient=patient,
        defaults={"source": DoctorPatientSource.WALK_IN},
    )
    link.last_treated_at = now
    link.save(update_fields=["last_treated_at", "updated_at"])
    return appointment


def suggest_followup_slot(doctor, recommended_date):
    """Earliest available future slot for the doctor on/after recommended_date."""
    return (
        TimeSlot.objects.filter(
            doctor=doctor,
            status=SlotStatus.AVAILABLE,
            date__gte=recommended_date,
            start_datetime__gte=timezone.now(),
        )
        .order_by("start_datetime")
        .first()
    )


@transaction.atomic
def reslot_stale_followup(followup):
    """Keep a SUGGESTED follow-up bookable.

    A follow-up pins one specific slot at suggestion time. If that slot later
    passes or gets taken, the suggestion becomes a dead-end the patient can't
    confirm. This re-points it at the next open slot for the same doctor near
    the recommended date. Returns True if the suggested slot changed.
    """
    from apps.core.enums import FollowUpStatus

    if followup.status != FollowUpStatus.SUGGESTED:
        return False

    slot = followup.suggested_slot
    still_bookable = (
        slot is not None
        and slot.status == SlotStatus.AVAILABLE
        and slot.start_datetime >= timezone.now()
    )
    if still_bookable:
        return False

    fresh = suggest_followup_slot(followup.doctor, followup.recommended_date)
    fresh_id = fresh.pk if fresh else None
    if fresh_id == followup.suggested_slot_id:
        return False  # nothing better available; leave as-is (patient books manually)

    followup.suggested_slot = fresh
    followup.save(update_fields=["suggested_slot", "updated_at"])
    return True


@transaction.atomic
def create_followup(*, origin_appointment, recommended_date, notes="", created_by=None):
    """Doctor recommends a follow-up; the system proposes the next open slot."""
    from apps.core.enums import FollowUpStatus, NotificationVerb
    from apps.notifications.services import notify

    from .models import FollowUp

    slot = suggest_followup_slot(origin_appointment.doctor, recommended_date)
    followup = FollowUp.objects.create(
        origin_appointment=origin_appointment,
        patient=origin_appointment.patient,
        doctor=origin_appointment.doctor,
        recommended_date=recommended_date,
        suggested_slot=slot,
        status=FollowUpStatus.SUGGESTED,
        notes=notes,
        created_by=created_by,
    )
    if slot:
        when, when_ar = format_when_bilingual(slot.start_datetime)
    else:
        when, when_ar = "a time soon", "وقت قريب"
    notify(
        recipient=origin_appointment.patient.user,
        verb=NotificationVerb.FOLLOWUP,
        title="Follow-up suggested",
        title_ar="اقتراح موعد متابعة",
        body=f"{origin_appointment.doctor} suggests a follow-up around {when}. Please confirm or dismiss.",
        body_ar=f"يقترح {doctor_display_name(origin_appointment.doctor, arabic=True)} موعد متابعة حوالي {when_ar}. يرجى التأكيد أو الرفض.",
        related=followup,
    )
    return followup


@transaction.atomic
def confirm_followup(followup, *, created_by=None):
    """Patient accepts the follow-up: book the suggested slot as a FOLLOW_UP visit."""
    from apps.core.enums import FollowUpStatus

    if followup.status != FollowUpStatus.SUGGESTED:
        raise ValidationError({"status": "This follow-up can no longer be confirmed."})
    if not followup.suggested_slot_id:
        raise ValidationError(
            {"detail": "No suggested time is available. Please book a visit manually."}
        )
    if followup.suggested_slot.start_datetime < timezone.now():
        raise ValidationError(
            {"detail": "This suggested time has passed. Please book a visit manually."}
        )
    appointment = book_slot(
        patient=followup.patient,
        slot_id=followup.suggested_slot_id,
        # No hardcoded English reason text -- the appointment_type=FOLLOW_UP
        # badge already conveys this, in whatever language the UI is in;
        # a free-text `reason` can't be localized after the fact.
        created_by=created_by,
        appointment_type=AppointmentType.FOLLOW_UP,
        bypass_accepting_gate=True,
    )
    followup.resulting_appointment = appointment
    followup.status = FollowUpStatus.SCHEDULED
    followup.save(update_fields=["resulting_appointment", "status", "updated_at"])
    return appointment


@transaction.atomic
def dismiss_followup(followup):
    from apps.core.enums import FollowUpStatus

    followup.status = FollowUpStatus.DISMISSED
    followup.save(update_fields=["status", "updated_at"])
    return followup
