"""Access control for AI Scribe sessions.

This is a doctor's tool. Doctors operate on sessions for patients they treat;
managers may see everything (oversight). Patients and secretaries have no access
to recorded consultations.
"""
from rest_framework.permissions import BasePermission

from apps.core.enums import RoleChoices
from apps.medical_records.permissions import doctor_treats


class AIScribePermission(BasePermission):
    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        # Only doctors create/record sessions; managers get read oversight.
        if request.method == "POST":
            return user.role == RoleChoices.DOCTOR
        return user.role in (RoleChoices.DOCTOR, RoleChoices.MANAGER)

    def has_object_permission(self, request, view, obj):
        user = request.user
        if user.role == RoleChoices.MANAGER:
            return True
        if user.role == RoleChoices.DOCTOR:
            # The recording doctor, or any doctor currently treating the patient.
            return obj.doctor_id == getattr(user.doctor_profile, "id", None) or doctor_treats(user, obj.patient)
        return False
