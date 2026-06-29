from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.generics import get_object_or_404
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.appointments.models import Appointment
from apps.core.enums import RoleChoices

from . import services
from .models import Complaint, Diagnosis, DiagnosisCategory, Encounter
from .permissions import EncounterPermission
from .serializers import (
    ComplaintSerializer,
    DiagnosisCategorySerializer,
    DiagnosisSerializer,
    EncounterReadSerializer,
    EncounterWriteSerializer,
)

_ENCOUNTER_RELATIONS = (
    "patient__user", "doctor__user", "diagnosis", "vitals", "appointment",
)


class EncounterViewSet(viewsets.ModelViewSet):
    permission_classes = [EncounterPermission]
    http_method_names = ["get", "post", "patch", "head", "options"]
    filterset_fields = ["patient", "status", "appointment", "is_current"]

    def get_queryset(self):
        user = self.request.user
        qs = Encounter.objects.select_related(*_ENCOUNTER_RELATIONS).prefetch_related(
            "prescriptions__items", "lab_orders__items"
        )
        if user.role == RoleChoices.MANAGER:
            return qs
        if user.role == RoleChoices.DOCTOR:
            return qs.filter(doctor__user=user)
        if user.role == RoleChoices.PATIENT:
            return qs.filter(patient__user=user)
        return qs.none()

    def get_serializer_class(self):
        if self.action in ("create", "update", "partial_update"):
            return EncounterWriteSerializer
        return EncounterReadSerializer

    def perform_create(self, serializer):
        user = self.request.user
        if user.role != RoleChoices.DOCTOR:
            raise PermissionDenied("Only doctors can create encounters.")
        serializer.save(doctor=user.doctor_profile)

    def partial_update(self, request, *args, **kwargs):
        instance = self.get_object()
        from .models import EncounterStatus

        if instance.status != EncounterStatus.DRAFT:
            raise PermissionDenied("Only a draft encounter can be edited.")
        serializer = EncounterWriteSerializer(instance, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        updated = serializer.save()
        # Return the full read representation so the frontend cache keeps status/relations intact.
        return Response(EncounterReadSerializer(updated).data)

    @action(detail=True, methods=["post"])
    def submit(self, request, pk=None):
        encounter = self.get_object()
        result = services.submit_encounter(encounter)
        return Response(EncounterReadSerializer(result).data)

    @action(detail=True, methods=["post"])
    def amend(self, request, pk=None):
        encounter = self.get_object()
        twin = services.amend_encounter(encounter)
        return Response(EncounterReadSerializer(twin).data)

    @action(detail=False, methods=["post"], url_path="draft-for-appointment")
    def draft_for_appointment(self, request):
        if request.user.role != RoleChoices.DOCTOR:
            raise PermissionDenied("Only doctors can open encounters.")
        appointment_id = request.data.get("appointment")
        if not appointment_id:
            raise ValidationError({"appointment": "An appointment id is required."})
        appointment = get_object_or_404(Appointment, pk=appointment_id)
        if appointment.doctor.user_id != request.user.id:
            raise PermissionDenied("You can only open encounters for your own appointments.")
        encounter = services.get_or_create_draft(
            appointment=appointment, doctor=request.user.doctor_profile
        )
        return Response(EncounterReadSerializer(encounter).data)


class ComplaintViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = ComplaintSerializer
    permission_classes = [IsAuthenticated]
    queryset = Complaint.objects.all()
    filterset_fields = ["category", "is_active"]
    search_fields = ["name", "name_ar"]


class DiagnosisViewSet(viewsets.ModelViewSet):
    serializer_class = DiagnosisSerializer
    permission_classes = [IsAuthenticated]
    http_method_names = ["get", "post", "head", "options"]
    queryset = Diagnosis.objects.select_related("category_ref")
    filterset_fields = ["category", "category_ref", "is_chronic", "is_active"]
    search_fields = ["name", "name_ar", "icd10_code"]

    def perform_create(self, serializer):
        # Doctors add a missing diagnosis on the fly; managers curate. Others read-only.
        if self.request.user.role not in (RoleChoices.DOCTOR, RoleChoices.MANAGER):
            raise PermissionDenied("Only doctors or managers can add diagnoses.")
        serializer.save()


class DiagnosisCategoryViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = DiagnosisCategorySerializer
    permission_classes = [IsAuthenticated]
    queryset = DiagnosisCategory.objects.all()
    filterset_fields = ["is_active"]
    search_fields = ["name", "name_ar"]
