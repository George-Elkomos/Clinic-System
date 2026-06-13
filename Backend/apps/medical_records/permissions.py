"""Object-level access control for clinical data.

Access = the owner patient, a treating doctor (via the DoctorPatient link), or a
manager. Secretaries are excluded from medical data entirely.
"""
from rest_framework.permissions import SAFE_METHODS, BasePermission

from apps.core.enums import RoleChoices

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
