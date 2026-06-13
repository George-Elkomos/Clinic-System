from rest_framework.permissions import BasePermission

from apps.core.enums import RoleChoices


class AppointmentPermission(BasePermission):
    """Patients book + view + cancel their own; doctors view/progress their own;
    secretaries/managers manage everything. Queryset scoping (in the viewset)
    is the primary guard; this is defense-in-depth at the object level."""

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated)

    def has_object_permission(self, request, view, obj):
        user = request.user
        if user.role in (RoleChoices.SECRETARY, RoleChoices.MANAGER):
            return True
        if user.role == RoleChoices.PATIENT:
            return obj.patient.user_id == user.id
        if user.role == RoleChoices.DOCTOR:
            return obj.doctor.user_id == user.id
        return False
