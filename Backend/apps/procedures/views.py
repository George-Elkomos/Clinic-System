from django.db.models import Q
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from apps.core.enums import RoleChoices
from apps.medical_records.permissions import doctor_may_record

from .models import ClinicalProcedure, ProcedureTemplate
from .permissions import ClinicalProcedurePermission, ProcedureTemplatePermission
from .serializers import (
    ClinicalProcedureListSerializer,
    ClinicalProcedureSerializer,
    ProcedureCancelSerializer,
    ProcedureCompleteSerializer,
    ProcedureTemplateSerializer,
)
from .services import cancel_procedure, complete_procedure, notify_scheduled, start_procedure


class ProcedureTemplateViewSet(viewsets.ModelViewSet):
    queryset = ProcedureTemplate.objects.all()
    serializer_class = ProcedureTemplateSerializer
    permission_classes = [ProcedureTemplatePermission]
    filterset_fields = ["category", "is_active"]


class ClinicalProcedureViewSet(viewsets.ModelViewSet):
    permission_classes = [ClinicalProcedurePermission]
    http_method_names = ["get", "post", "patch", "head", "options"]
    filterset_fields = ["patient", "doctor", "status", "appointment", "encounter"]

    def get_queryset(self):
        user = self.request.user
        qs = ClinicalProcedure.objects.select_related(
            "patient__user", "doctor__user", "appointment", "encounter", "template",
        )
        if user.role == RoleChoices.MANAGER:
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
            return ClinicalProcedureListSerializer
        return ClinicalProcedureSerializer

    def perform_create(self, serializer):
        user = self.request.user
        patient = serializer.validated_data.get("patient")
        if not doctor_may_record(user, patient):
            raise PermissionDenied("You can only add procedures for your own patients.")
        serializer.save(doctor=user.doctor_profile)
        notify_scheduled(serializer.instance)

    @action(detail=True, methods=["post"])
    def start(self, request, pk=None):
        procedure = self.get_object()
        if procedure.doctor.user_id != request.user.id and request.user.role != RoleChoices.MANAGER:
            raise PermissionDenied("Only the performing doctor can start this procedure.")
        result = start_procedure(procedure)
        return Response(ClinicalProcedureSerializer(result, context={"request": request}).data)

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        procedure = self.get_object()
        if procedure.doctor.user_id != request.user.id and request.user.role != RoleChoices.MANAGER:
            raise PermissionDenied("Only the performing doctor can complete this procedure.")
        input_serializer = ProcedureCompleteSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        result = complete_procedure(procedure, **input_serializer.validated_data)
        return Response(ClinicalProcedureSerializer(result, context={"request": request}).data)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        procedure = self.get_object()
        if procedure.doctor.user_id != request.user.id and request.user.role != RoleChoices.MANAGER:
            raise PermissionDenied("Only the performing doctor can cancel this procedure.")
        input_serializer = ProcedureCancelSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        result = cancel_procedure(procedure, input_serializer.validated_data["reason"], request.user)
        return Response(ClinicalProcedureSerializer(result, context={"request": request}).data)
