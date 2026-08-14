from rest_framework.permissions import SAFE_METHODS, BasePermission

from apps.core.enums import RoleChoices


class DoctorProfilePermission(BasePermission):
    """Anyone authenticated may read a doctor profile (needed to book).
    Writing is limited to the doctor themselves, secretaries, and managers."""

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        if request.method in SAFE_METHODS:
            return True
        return user.role in (RoleChoices.SECRETARY, RoleChoices.MANAGER, RoleChoices.DOCTOR)

    def has_object_permission(self, request, view, obj):
        user = request.user
        if request.method in SAFE_METHODS:
            return True
        if user.role in (RoleChoices.SECRETARY, RoleChoices.MANAGER):
            return True
        # A doctor may only edit their own profile.
        return user.role == RoleChoices.DOCTOR and obj.user_id == user.id


class OwnsDoctorResource(BasePermission):
    """For schedules/absences ("schedule management"): the owning doctor or
    manager may write; secretaries may view any doctor's schedule (for desk
    booking) but not create/edit/delete it."""

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated and user.role in (
            RoleChoices.DOCTOR, RoleChoices.SECRETARY, RoleChoices.MANAGER
        )):
            return False
        if user.role == RoleChoices.SECRETARY:
            return request.method in SAFE_METHODS
        return True

    def has_object_permission(self, request, view, obj):
        user = request.user
        if user.role == RoleChoices.MANAGER:
            return True
        if user.role == RoleChoices.SECRETARY:
            return request.method in SAFE_METHODS
        return user.role == RoleChoices.DOCTOR and obj.doctor.user_id == user.id
