"""Permission class for the Vital Signs module.

Differs from MedicalDataPermission in two ways:
  1. Secretaries CAN read (they need vitals at the desk).
  2. Edits are time-limited to 24 hours (except managers).
"""
from datetime import timedelta

from django.utils import timezone
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import SAFE_METHODS, BasePermission

from apps.core.enums import RoleChoices
from apps.medical_records.permissions import doctor_treats

EDIT_WINDOW_HOURS = 24


class VitalSignsPermission(BasePermission):
    """
    Read:   Patient (own), Doctor (treating), Secretary (all), Manager (all)
    Create: Doctor, Secretary, Manager  — NOT patient
    Edit:   Doctor (own patients, within 24 h), Secretary (all, within 24 h),
            Manager (no time restriction)
    Delete: Manager only (soft-delete)
    """

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        role = user.role
        if request.method in SAFE_METHODS:
            return role in (
                RoleChoices.PATIENT,
                RoleChoices.DOCTOR,
                RoleChoices.SECRETARY,
                RoleChoices.MANAGER,
            )
        if request.method == "DELETE":
            return role == RoleChoices.MANAGER
        # POST / PATCH — staff only
        return role in (
            RoleChoices.DOCTOR,
            RoleChoices.SECRETARY,
            RoleChoices.MANAGER,
        )

    def has_object_permission(self, request, view, obj):
        user = request.user
        role = user.role

        # --- Safe methods ---
        if request.method in SAFE_METHODS:
            if role == RoleChoices.MANAGER:
                return True
            if role == RoleChoices.SECRETARY:
                return True
            if role == RoleChoices.PATIENT:
                return obj.patient.user_id == user.id
            if role == RoleChoices.DOCTOR:
                return doctor_treats(user, obj.patient)
            return False

        # --- Delete (manager only, already gated at has_permission) ---
        if request.method == "DELETE":
            return role == RoleChoices.MANAGER

        # --- Patch: check edit window ---
        if role == RoleChoices.MANAGER:
            return True

        cutoff = timezone.now() - timedelta(hours=EDIT_WINDOW_HOURS)
        if obj.created_at < cutoff:
            raise PermissionDenied(
                f"Vital signs can only be edited within {EDIT_WINDOW_HOURS} hours of recording."
            )

        if role == RoleChoices.DOCTOR:
            return doctor_treats(user, obj.patient)
        if role == RoleChoices.SECRETARY:
            return True
        return False
