"""Access control for referrals.

Create/accept/complete/cancel: doctor-only at this layer (fine-grained
eligibility — is this doctor actually the recipient/acceptor? — is enforced
inside services.py). Read: the referring doctor, the eligible receiving
doctor, the owning patient, a manager, or a secretary (read-only, clinic-wide,
so front desk can chase up scheduling — see ReferralLimitedSerializer, which
strips the clinical reason/notes text before it ever reaches them).
"""
from rest_framework.permissions import SAFE_METHODS, BasePermission

from apps.core.enums import RoleChoices

REFERRAL_ROLES = (RoleChoices.PATIENT, RoleChoices.DOCTOR, RoleChoices.SECRETARY, RoleChoices.MANAGER)
_WRITE_ACTIONS = ("create", "accept", "complete", "cancel")


class ReferralPermission(BasePermission):
    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated and user.role in REFERRAL_ROLES):
            return False
        if view.action in _WRITE_ACTIONS and user.role in (RoleChoices.PATIENT, RoleChoices.SECRETARY):
            return False
        return True

    def has_object_permission(self, request, view, obj):
        user = request.user
        if user.role == RoleChoices.MANAGER:
            return True
        if user.role == RoleChoices.SECRETARY:
            return request.method in SAFE_METHODS
        if user.role == RoleChoices.PATIENT:
            return request.method in SAFE_METHODS and obj.patient.user_id == user.id
        if user.role == RoleChoices.DOCTOR:
            doctor_profile = getattr(user, "doctor_profile", None)
            if doctor_profile is None:
                return False
            if obj.referring_doctor_id == doctor_profile.id:
                return True
            if obj.target_doctor_id == doctor_profile.id:
                return True
            if obj.accepted_by_id == doctor_profile.id:
                return True
            # Unassigned internal referral visible to any doctor in the specialty.
            return (
                obj.target_doctor_id is None
                and obj.specialty_id is not None
                and obj.specialty.doctors.filter(pk=doctor_profile.pk).exists()
            )
        return False
