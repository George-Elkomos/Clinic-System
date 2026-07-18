"""Billing RBAC (layer 2 + 3 glue).

- Catalog: staff read, manager writes.
- Invoices: read-only API; patients are scoped to their own rows in
  get_queryset() (layer 3), staff see all.
- Payments: front desk only (secretary/manager).
"""
from rest_framework.permissions import SAFE_METHODS, BasePermission

from apps.core.enums import RoleChoices

STAFF_ROLES = (RoleChoices.DOCTOR, RoleChoices.SECRETARY, RoleChoices.MANAGER)


class ServiceItemPermission(BasePermission):
    """Staff may browse the price catalog; only managers may change it."""

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        if request.method in SAFE_METHODS:
            return user.role in STAFF_ROLES
        return user.role == RoleChoices.MANAGER
