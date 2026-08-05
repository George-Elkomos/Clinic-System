"""Access control for RadiologyTemplate / RadiologyOrder."""
from rest_framework.permissions import SAFE_METHODS, BasePermission

from apps.core.enums import RadiologyOrderStatus, RoleChoices
from apps.medical_records.permissions import doctor_treats


class RadiologyTemplatePermission(BasePermission):
    """Read: any authenticated staff. Write: DOCTOR or MANAGER only."""

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        if request.method in SAFE_METHODS:
            return True
        return user.role in (RoleChoices.DOCTOR, RoleChoices.MANAGER)


class RadiologyOrderPermission(BasePermission):
    """
    Create: DOCTOR only.
    Read:   PATIENT (own), DOCTOR (ordering/treating), SECRETARY+MANAGER (all).
    Transition actions: role-specific (enforced in view actions + service layer).
    Delete: ORDERED status only; DOCTOR (ordering) or MANAGER.
    """

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        if request.method == "POST" and view.action == "create":
            return user.role == RoleChoices.DOCTOR
        # Patients are read-only — block any mutating method at view level
        if user.role == RoleChoices.PATIENT and request.method not in SAFE_METHODS:
            return False
        return True

    def has_object_permission(self, request, view, obj):
        user = request.user
        if user.role == RoleChoices.MANAGER:
            return True
        if user.role == RoleChoices.SECRETARY:
            # Secretaries may read and perform operational transitions; no delete
            if view.action == "destroy":
                return False
            return True
        if user.role == RoleChoices.PATIENT:
            if request.method not in SAFE_METHODS:
                return False
            return obj.patient.user_id == user.id
        if user.role == RoleChoices.DOCTOR:
            is_ordering = obj.doctor.user_id == user.id
            is_treating = doctor_treats(user, obj.patient)
            if view.action == "destroy":
                return is_ordering and obj.status == RadiologyOrderStatus.ORDERED
            return is_ordering or is_treating
        return False
