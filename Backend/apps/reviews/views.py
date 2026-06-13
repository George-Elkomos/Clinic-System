from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.enums import RoleChoices

from .models import Review
from .permissions import ReviewPermission
from .serializers import (
    HideReviewSerializer,
    ReviewModerationSerializer,
    ReviewSerializer,
    ReviewWriteSerializer,
)


class ReviewViewSet(viewsets.ModelViewSet):
    permission_classes = [ReviewPermission]
    http_method_names = ["get", "post", "head", "options"]
    filterset_fields = ["doctor", "rating", "is_hidden"]

    def get_queryset(self):
        qs = Review.objects.select_related("patient__user", "doctor__user")
        user = self.request.user
        doctor_id = self.request.query_params.get("doctor")
        if doctor_id and not (
            user and user.is_authenticated and user.role == RoleChoices.MANAGER
        ):
            return qs.filter(doctor_id=doctor_id, is_hidden=False)
        if not (user and user.is_authenticated):
            return qs.none()
        if user.role == RoleChoices.PATIENT:
            return qs.filter(patient__user=user)
        if user.role == RoleChoices.DOCTOR:
            return qs.filter(doctor__user=user)
        return qs  # manager

    def get_serializer_class(self):
        if self.action == "create":
            return ReviewWriteSerializer
        user = self.request.user
        if user and user.is_authenticated and user.role == RoleChoices.MANAGER:
            return ReviewModerationSerializer
        return ReviewSerializer

    def perform_create(self, serializer):
        appointment = serializer.validated_data["appointment"]
        serializer.save(
            patient=self.request.user.patient_profile,
            doctor=appointment.doctor,
        )

    def _moderate(self, request, hidden):
        if request.user.role != RoleChoices.MANAGER:
            from rest_framework.exceptions import PermissionDenied

            raise PermissionDenied("Only a manager can moderate reviews.")
        review = self.get_object()
        serializer = HideReviewSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        review.is_hidden = hidden
        review.hidden_by = request.user if hidden else None
        review.hidden_reason = serializer.validated_data.get("reason", "") if hidden else ""
        review.save(update_fields=["is_hidden", "hidden_by", "hidden_reason", "updated_at"])
        return Response(ReviewModerationSerializer(review).data)

    @action(detail=True, methods=["post"])
    def hide(self, request, pk=None):
        return self._moderate(request, hidden=True)

    @action(detail=True, methods=["post"])
    def unhide(self, request, pk=None):
        return self._moderate(request, hidden=False)
