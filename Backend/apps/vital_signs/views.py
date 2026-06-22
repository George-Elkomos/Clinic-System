from rest_framework import viewsets
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.core.enums import RoleChoices
from apps.medical_records.permissions import doctor_may_record

from .models import VitalSigns
from .permissions import VitalSignsPermission
from .serializers import VitalSignsReadSerializer, VitalSignsWriteSerializer


class VitalSignsViewSet(viewsets.ModelViewSet):
    permission_classes = [VitalSignsPermission]
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]
    filterset_fields = ["patient", "appointment"]

    def get_queryset(self):
        user = self.request.user
        qs = VitalSigns.objects.select_related(
            "patient__user", "recorded_by", "appointment"
        )
        if user.role in (RoleChoices.MANAGER, RoleChoices.SECRETARY):
            return qs.order_by("-created_at")
        if user.role == RoleChoices.PATIENT:
            return qs.filter(patient__user=user).order_by("-created_at")
        if user.role == RoleChoices.DOCTOR:
            return (
                qs.filter(patient__treating_doctors__doctor__user=user)
                .distinct()
                .order_by("-created_at")
            )
        return qs.none()

    def get_serializer_class(self):
        if self.request.method in ("POST", "PATCH"):
            return VitalSignsWriteSerializer
        return VitalSignsReadSerializer

    def perform_create(self, serializer):
        user = self.request.user
        if user.role == RoleChoices.PATIENT:
            raise PermissionDenied("Patients cannot record vital signs.")
        patient = serializer.validated_data.get("patient")
        if patient is None:
            raise ValidationError({"patient": "A patient must be specified."})
        if user.role == RoleChoices.DOCTOR and not doctor_may_record(user, patient):
            raise PermissionDenied(
                "You can only record vital signs for your own patients."
            )
        serializer.save(recorded_by=user)

    def perform_destroy(self, instance):
        instance.soft_delete()
