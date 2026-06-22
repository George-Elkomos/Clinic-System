"""Access control for encounters.

Create/write/submit/amend: the owning doctor (or manager). Read: owning patient,
owning doctor, or manager. Secretaries have no access to encounters.
"""
from rest_framework.permissions import SAFE_METHODS, BasePermission

from apps.core.enums import RoleChoices

ENCOUNTER_ROLES = (RoleChoices.PATIENT, RoleChoices.DOCTOR, RoleChoices.MANAGER)


class EncounterPermission(BasePermission):
    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated and user.role in ENCOUNTER_ROLES):
            return False
        # Creating / writing is doctor-only at the collection level.
        if request.method not in SAFE_METHODS and user.role == RoleChoices.PATIENT:
            return False
        if view.action in ("create", "draft_for_appointment"):
            return user.role == RoleChoices.DOCTOR
        return True

    def has_object_permission(self, request, view, obj):
        user = request.user
        if user.role == RoleChoices.MANAGER:
            return True
        if user.role == RoleChoices.PATIENT:
            return request.method in SAFE_METHODS and obj.patient.user_id == user.id
        if user.role == RoleChoices.DOCTOR:
            return obj.doctor is not None and obj.doctor.user_id == user.id
        return False
