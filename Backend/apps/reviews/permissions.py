"""Review access: patients create/read their own; doctors read their own
(comments visible); managers moderate; secretaries are excluded entirely."""
from rest_framework.permissions import SAFE_METHODS, BasePermission

from apps.core.enums import RoleChoices

REVIEW_ROLES = (RoleChoices.PATIENT, RoleChoices.DOCTOR, RoleChoices.MANAGER)


class ReviewPermission(BasePermission):
    def has_permission(self, request, view):
        user = request.user
        if request.method in SAFE_METHODS and request.query_params.get("doctor"):
            return True
        if not (user and user.is_authenticated and user.role in REVIEW_ROLES):
            return False
        # Only patients create reviews (moderation actions like hide/unhide are
        # POSTs too, so gate on the action, not the method).
        if getattr(view, "action", None) == "create" and user.role != RoleChoices.PATIENT:
            return False
        return True

    def has_object_permission(self, request, view, obj):
        user = request.user
        if user.role == RoleChoices.MANAGER:
            return True
        if user.role == RoleChoices.PATIENT:
            return obj.patient.user_id == user.id
        if user.role == RoleChoices.DOCTOR:
            # Read-only access to reviews about themselves.
            return request.method in SAFE_METHODS and obj.doctor.user_id == user.id
        return False
