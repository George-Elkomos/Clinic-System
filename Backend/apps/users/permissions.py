"""Reusable role-based permission classes (layer 2 of the 3-layer RBAC).

Layer 1 = authentication (JWT, IsAuthenticated globally).
Layer 2 = these coarse role checks (view-level).
Layer 3 = get_queryset() scoping + has_object_permission() (in each app).
"""
from rest_framework.permissions import SAFE_METHODS, BasePermission

from apps.core.enums import RoleChoices


class _RolePermission(BasePermission):
    role = None

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and user.role == self.role)


class IsPatient(_RolePermission):
    role = RoleChoices.PATIENT


class IsDoctor(_RolePermission):
    role = RoleChoices.DOCTOR


class IsSecretary(_RolePermission):
    role = RoleChoices.SECRETARY


class IsManager(_RolePermission):
    role = RoleChoices.MANAGER


class IsInRoles(BasePermission):
    """Allow any of a set of roles. Subclass and set `allowed_roles`."""

    allowed_roles: tuple = ()

    def has_permission(self, request, view):
        user = request.user
        return bool(
            user and user.is_authenticated and user.role in self.allowed_roles
        )


class IsDoctorOrManager(IsInRoles):
    allowed_roles = (RoleChoices.DOCTOR, RoleChoices.MANAGER)


class IsSecretaryOrManager(IsInRoles):
    allowed_roles = (RoleChoices.SECRETARY, RoleChoices.MANAGER)


class IsStaffRole(IsInRoles):
    """Doctor, Secretary, or Manager (i.e. not a patient)."""

    allowed_roles = (RoleChoices.DOCTOR, RoleChoices.SECRETARY, RoleChoices.MANAGER)


class ReadOnlyOrManager(BasePermission):
    """Anyone may read; only managers may write."""

    def has_permission(self, request, view):
        user = request.user
        if request.method in SAFE_METHODS:
            return True
        return bool(user and user.is_authenticated and user.role == RoleChoices.MANAGER)
