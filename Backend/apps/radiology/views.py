from django.db.models import Q
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from apps.core.enums import RoleChoices
from apps.medical_records.permissions import doctor_treats

from . import services
from .models import RadiologyOrder, RadiologyTemplate
from .permissions import RadiologyOrderPermission, RadiologyTemplatePermission
from .serializers import (
    RadiologyOrderCancelSerializer,
    RadiologyOrderCompleteSerializer,
    RadiologyOrderListSerializer,
    RadiologyOrderReportSerializer,
    RadiologyOrderSerializer,
    RadiologyTemplateSerializer,
)


class RadiologyTemplateViewSet(viewsets.ModelViewSet):
    queryset = RadiologyTemplate.objects.all()
    serializer_class = RadiologyTemplateSerializer
    permission_classes = [RadiologyTemplatePermission]
    filterset_fields = ["modality", "is_active"]


class RadiologyOrderViewSet(viewsets.ModelViewSet):
    permission_classes = [RadiologyOrderPermission]
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]
    filterset_fields = ["patient", "doctor", "status", "priority", "appointment", "encounter"]

    def get_queryset(self):
        user = self.request.user
        qs = RadiologyOrder.objects.select_related(
            "patient__user", "doctor__user", "appointment", "encounter", "template",
        )
        if user.role in (RoleChoices.MANAGER, RoleChoices.SECRETARY):
            return qs.order_by("-created_at")
        if user.role == RoleChoices.PATIENT:
            return qs.filter(patient__user=user).order_by("-created_at")
        if user.role == RoleChoices.DOCTOR:
            return (
                qs.filter(Q(doctor__user=user) | Q(patient__treating_doctors__doctor__user=user))
                .distinct()
                .order_by("-created_at")
            )
        return qs.none()

    def get_serializer_class(self):
        if self.action == "list":
            return RadiologyOrderListSerializer
        return RadiologyOrderSerializer

    def perform_create(self, serializer):
        user = self.request.user
        if user.role != RoleChoices.DOCTOR:
            raise PermissionDenied("Only doctors can create radiology orders.")
        patient = serializer.validated_data.get("patient")
        if patient and not doctor_treats(user, patient):
            raise PermissionDenied("You can only order radiology studies for your own patients.")
        serializer.save(doctor=user.doctor_profile)
        services.notify_ordered(serializer.instance)

    def destroy(self, request, *args, **kwargs):
        order = self.get_object()
        order.soft_delete()
        return Response(status=204)

    @action(
        detail=True, methods=["post"],
        parser_classes=[MultiPartParser, FormParser, JSONParser],
    )
    def complete(self, request, pk=None):
        order = self.get_object()
        user = request.user
        is_ordering_doctor = order.doctor.user_id == user.id
        if user.role not in (RoleChoices.SECRETARY, RoleChoices.MANAGER) and not (
            user.role == RoleChoices.DOCTOR and is_ordering_doctor
        ):
            raise PermissionDenied("Only radiology staff or the ordering doctor can complete this order.")
        input_serializer = RadiologyOrderCompleteSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        result = services.complete_order(
            order,
            file=input_serializer.validated_data["file"],
            uploaded_by=user,
            description=input_serializer.validated_data.get("description", ""),
        )
        return Response(RadiologyOrderSerializer(result, context={"request": request}).data)

    @action(detail=True, methods=["post"])
    def report(self, request, pk=None):
        order = self.get_object()
        if order.doctor.user_id != request.user.id and request.user.role != RoleChoices.MANAGER:
            raise PermissionDenied("Only the ordering doctor or a manager can report this order.")
        input_serializer = RadiologyOrderReportSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        result = services.report_order(order, **input_serializer.validated_data)
        return Response(RadiologyOrderSerializer(result, context={"request": request}).data)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        order = self.get_object()
        if order.doctor.user_id != request.user.id and request.user.role != RoleChoices.MANAGER:
            raise PermissionDenied("Only the ordering doctor or a manager can cancel this order.")
        input_serializer = RadiologyOrderCancelSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        result = services.cancel_order(order, input_serializer.validated_data["reason"], request.user)
        return Response(RadiologyOrderSerializer(result, context={"request": request}).data)
