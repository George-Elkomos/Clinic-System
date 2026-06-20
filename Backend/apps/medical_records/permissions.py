"""Object-level access control for clinical data.

Access = the owner patient, a treating doctor (via the DoctorPatient link), or a
manager. Secretaries are excluded from medical data entirely.
"""
from rest_framework.permissions import SAFE_METHODS, BasePermission
from rest_framework.exceptions import PermissionDenied

from apps.core.enums import LabOrderStatus, RoleChoices

MEDICAL_ROLES = (RoleChoices.PATIENT, RoleChoices.DOCTOR, RoleChoices.MANAGER)


def doctor_treats(user, patient):
    """True if `user` (a doctor) has a DoctorPatient link to `patient`."""
    return patient.treating_doctors.filter(doctor__user=user).exists()


class MedicalDataPermission(BasePermission):
    """For MedicalRecord / Scan / LabResult / Prescription."""

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and user.role in MEDICAL_ROLES)

    def has_object_permission(self, request, view, obj):
        user = request.user
        if user.role == RoleChoices.MANAGER:
            return True
        if user.role == RoleChoices.PATIENT:
            return obj.patient.user_id == user.id
        if user.role == RoleChoices.DOCTOR:
            return doctor_treats(user, obj.patient)
        return False


class ClinicalNotePermission(BasePermission):
    """Read like medical data; writing requires a DOCTOR whose specialty
    categories include the note's specialty_category (enforced fully in the
    serializer's validate(); this is the coarse view-level gate)."""

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated and user.role in MEDICAL_ROLES):
            return False
        if request.method in SAFE_METHODS:
            return True
        return user.role == RoleChoices.DOCTOR

    def has_object_permission(self, request, view, obj):
        user = request.user
        if request.method in SAFE_METHODS:
            if user.role == RoleChoices.MANAGER:
                return True
            if user.role == RoleChoices.PATIENT:
                return obj.patient.user_id == user.id
            return doctor_treats(user, obj.patient)
        # Write: must be a treating doctor (specialty match checked in serializer).
        return user.role == RoleChoices.DOCTOR and doctor_treats(user, obj.patient)


class LabOrderPermission(BasePermission):
    """
    Create: DOCTOR only.
    Read:   PATIENT (own), DOCTOR (ordering/treating), SECRETARY+MANAGER (all).
    Transition actions: role-specific (enforced in view actions + service layer).
    Delete: DRAFT status only; DOCTOR (ordering) or MANAGER.
    """

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        # Create is doctor-only
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
            # Patients are strictly read-only on lab orders
            if request.method not in SAFE_METHODS:
                return False
            return obj.patient.user_id == user.id
        if user.role == RoleChoices.DOCTOR:
            is_ordering = obj.doctor.user_id == user.id
            is_treating = doctor_treats(user, obj.patient)
            if view.action == "destroy":
                return is_ordering and obj.status == LabOrderStatus.DRAFT
            return is_ordering or is_treating
        return False
