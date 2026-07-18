"""Referral lifecycle services.

State machine:
    PENDING --accept--> ACCEPTED --complete--> COMPLETED
    PENDING/ACCEPTED --cancel--> CANCELLED

Accepting/completing/cancelling notify the other party; completing also links
the accepting doctor to the patient via DoctorPatient (source=REFERRAL) so the
existing "doctors only see their own patients" scoping picks the patient up.
"""
from django.db import transaction
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.core.enums import DoctorPatientSource, NotificationVerb, ReferralStatus, RoleChoices
from apps.notifications.services import notify

from .models import Referral


def create_referral(*, encounter, doctor, **data):
    if encounter.doctor_id != doctor.id:
        raise PermissionDenied("You can only refer patients from your own encounters.")

    referral = Referral.objects.create(
        patient=encounter.patient,
        referring_doctor=doctor,
        encounter=encounter,
        **data,
    )

    target_doctor = referral.target_doctor
    if target_doctor is not None:
        notify(
            recipient=target_doctor.user,
            verb=NotificationVerb.REFERRAL_CREATED,
            title="New patient referral",
            title_ar="إحالة مريض جديدة",
            body=f"Dr. {doctor.user.get_full_name()} referred {referral.patient.user.get_full_name()} to you.",
            related=referral,
        )
    return referral


def _is_eligible_recipient(referral, doctor):
    if referral.target_doctor_id is not None:
        return referral.target_doctor_id == doctor.id
    return referral.specialty_id is not None and referral.specialty.doctors.filter(pk=doctor.pk).exists()


@transaction.atomic
def accept_referral(referral, doctor):
    if referral.status != ReferralStatus.PENDING:
        raise ValidationError({"status": "Only a pending referral can be accepted."})
    if not _is_eligible_recipient(referral, doctor):
        raise PermissionDenied("You are not the recipient of this referral.")

    referral.status = ReferralStatus.ACCEPTED
    referral.accepted_by = doctor
    referral.save(update_fields=["status", "accepted_by", "updated_at"])

    if referral.referring_doctor_id is not None:
        notify(
            recipient=referral.referring_doctor.user,
            verb=NotificationVerb.REFERRAL_ACCEPTED,
            title="Referral accepted",
            title_ar="تم قبول الإحالة",
            body=f"Dr. {doctor.user.get_full_name()} accepted your referral for {referral.patient.user.get_full_name()}.",
            related=referral,
        )
    return referral


@transaction.atomic
def complete_referral(referral, doctor):
    if referral.status != ReferralStatus.ACCEPTED:
        raise ValidationError({"status": "Only an accepted referral can be completed."})
    if referral.accepted_by_id != doctor.id:
        raise PermissionDenied("Only the doctor who accepted this referral can complete it.")

    referral.status = ReferralStatus.COMPLETED
    referral.save(update_fields=["status", "updated_at"])

    from apps.doctors.models import DoctorPatient

    link, _ = DoctorPatient.objects.get_or_create(
        doctor=doctor, patient=referral.patient,
        defaults={"source": DoctorPatientSource.REFERRAL},
    )
    link.last_treated_at = referral.updated_at
    link.save(update_fields=["last_treated_at", "updated_at"])

    if referral.referring_doctor_id is not None:
        notify(
            recipient=referral.referring_doctor.user,
            verb=NotificationVerb.REFERRAL_COMPLETED,
            title="Referral completed",
            title_ar="تم إتمام الإحالة",
            body=f"Dr. {doctor.user.get_full_name()} completed your referral for {referral.patient.user.get_full_name()}.",
            related=referral,
        )
    return referral


@transaction.atomic
def cancel_referral(referral, user):
    if referral.status not in (ReferralStatus.PENDING, ReferralStatus.ACCEPTED):
        raise ValidationError({"status": "Only a pending or accepted referral can be cancelled."})

    is_referring_doctor = (
        referral.referring_doctor is not None and referral.referring_doctor.user_id == user.id
    )
    if not (is_referring_doctor or user.role == RoleChoices.MANAGER):
        raise PermissionDenied("Only the referring doctor or a manager can cancel this referral.")

    referral.status = ReferralStatus.CANCELLED
    referral.save(update_fields=["status", "updated_at"])

    # Notify whichever side didn't perform the cancellation (both, if a manager did it).
    notify_recipient = referral.accepted_by or referral.target_doctor
    if referral.referring_doctor_id is not None and referral.referring_doctor.user_id != user.id:
        notify(
            recipient=referral.referring_doctor.user,
            verb=NotificationVerb.REFERRAL_CANCELLED,
            title="Referral cancelled",
            title_ar="تم إلغاء الإحالة",
            body=f"The referral for {referral.patient.user.get_full_name()} was cancelled.",
            related=referral,
        )
    if notify_recipient is not None and notify_recipient.user_id != user.id:
        notify(
            recipient=notify_recipient.user,
            verb=NotificationVerb.REFERRAL_CANCELLED,
            title="Referral cancelled",
            title_ar="تم إلغاء الإحالة",
            body=f"The referral for {referral.patient.user.get_full_name()} was cancelled.",
            related=referral,
        )
    return referral
