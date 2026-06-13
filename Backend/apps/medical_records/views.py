from django.http import FileResponse
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.generics import ListAPIView
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from apps.core.enums import RoleChoices
from apps.users.models import PatientProfile
from apps.users.permissions import IsDoctorOrManager

from .models import ClinicalNote, LabResult, MedicalRecord, Prescription, Scan
from .permissions import ClinicalNotePermission, MedicalDataPermission, doctor_treats
from .serializers import (
    ClinicalNoteSerializer,
    LabResultSerializer,
    MedicalRecordSerializer,
    PatientSummarySerializer,
    PrescriptionSerializer,
    ScanSerializer,
)
from .services.pdf import render_prescription_pdf
from .services.records import create_record_version


def scope_to_user(qs, user):
    """Limit a patient-owned queryset to what the user may see."""
    if user.role == RoleChoices.MANAGER:
        return qs
    if user.role == RoleChoices.PATIENT:
        return qs.filter(patient__user=user)
    if user.role == RoleChoices.DOCTOR:
        return qs.filter(patient__treating_doctors__doctor__user=user).distinct()
    return qs.none()


class MedicalScopedMixin:
    """Shared role scoping + patient resolution for medical viewsets."""

    permission_classes = [MedicalDataPermission]

    def _resolve_patient(self, serializer):
        user = self.request.user
        if user.role == RoleChoices.PATIENT:
            return user.patient_profile  # patients act only on themselves
        patient = serializer.validated_data.get("patient")
        if patient is None:
            raise ValidationError({"patient": "Select a patient."})
        if user.role == RoleChoices.DOCTOR and not doctor_treats(user, patient):
            raise PermissionDenied("You can only manage records for your own patients.")
        return patient


class MedicalRecordViewSet(MedicalScopedMixin, viewsets.ModelViewSet):
    serializer_class = MedicalRecordSerializer
    http_method_names = ["get", "post", "head", "options"]  # append-only (no PATCH/DELETE)
    filterset_fields = ["patient", "is_current"]

    def get_queryset(self):
        qs = MedicalRecord.objects.select_related("doctor__user", "patient__user")
        qs = scope_to_user(qs, self.request.user)
        if self.request.query_params.get("current") == "true":
            qs = qs.filter(is_current=True)
        return qs.order_by("-version")

    def create(self, request, *args, **kwargs):
        if request.user.role == RoleChoices.PATIENT:
            raise PermissionDenied("Patients cannot author clinical records.")
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        patient = self._resolve_patient(serializer)
        doctor = request.user.doctor_profile if request.user.role == RoleChoices.DOCTOR else None
        v = serializer.validated_data
        record = create_record_version(
            patient=patient, doctor=doctor,
            data={
                "chief_complaint": v.get("chief_complaint", ""),
                "diagnosis": v.get("diagnosis", ""),
                "treatment_plan": v.get("treatment_plan", ""),
                "vitals": v.get("vitals", {}) or {},
                "appointment": v.get("appointment"),
            },
        )
        return Response(MedicalRecordSerializer(record).data, status=201)


class ClinicalNoteViewSet(MedicalScopedMixin, viewsets.ModelViewSet):
    serializer_class = ClinicalNoteSerializer
    permission_classes = [ClinicalNotePermission]
    http_method_names = ["get", "post", "patch", "head", "options"]
    filterset_fields = ["patient", "specialty_category"]

    def get_queryset(self):
        qs = ClinicalNote.objects.select_related(
            "doctor__user", "patient__user", "specialty_category"
        )
        return scope_to_user(qs, self.request.user).order_by("-created_at")

    def perform_create(self, serializer):
        patient = self._resolve_patient(serializer)
        serializer.save(doctor=self.request.user.doctor_profile, patient=patient)


class _UploadViewSet(MedicalScopedMixin, viewsets.ModelViewSet):
    """Shared upload behaviour for scans + lab results."""

    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def perform_create(self, serializer):
        patient = self._resolve_patient(serializer)
        extra = {"patient": patient, "uploaded_by": self.request.user}
        f = serializer.validated_data.get("file")
        if f is not None:
            extra.update(
                original_filename=f.name[:255],
                content_type=getattr(f, "content_type", "") or "",
                file_size=f.size,
            )
        serializer.save(**extra)

    @action(detail=True, methods=["get"])
    def download(self, request, pk=None):
        obj = self.get_object()  # enforces object-level permission
        if not obj.file:
            raise ValidationError({"file": "No file attached."})
        return FileResponse(
            obj.file.open("rb"), as_attachment=True,
            filename=getattr(obj, "original_filename", None) or obj.file.name.split("/")[-1],
        )


class ScanViewSet(_UploadViewSet):
    serializer_class = ScanSerializer
    filterset_fields = ["patient", "category"]

    def get_queryset(self):
        qs = Scan.objects.select_related("patient__user", "uploaded_by")
        return scope_to_user(qs, self.request.user).order_by("-created_at")


class LabResultViewSet(_UploadViewSet):
    serializer_class = LabResultSerializer
    filterset_fields = ["patient", "category", "is_abnormal"]

    def get_queryset(self):
        qs = LabResult.objects.select_related("patient__user", "uploaded_by")
        return scope_to_user(qs, self.request.user).order_by("-created_at")


class PrescriptionViewSet(MedicalScopedMixin, viewsets.ModelViewSet):
    serializer_class = PrescriptionSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]
    filterset_fields = ["patient", "status"]

    def get_queryset(self):
        qs = Prescription.objects.select_related(
            "doctor__user", "patient__user"
        ).prefetch_related("items")
        return scope_to_user(qs, self.request.user).order_by("-created_at")

    def perform_create(self, serializer):
        if self.request.user.role != RoleChoices.DOCTOR:
            raise PermissionDenied("Only doctors can issue prescriptions.")
        patient = self._resolve_patient(serializer)
        serializer.save(doctor=self.request.user.doctor_profile, patient=patient)

    @action(detail=True, methods=["get"])
    def pdf(self, request, pk=None):
        prescription = self.get_object()  # enforces object-level permission
        pdf_bytes = render_prescription_pdf(prescription)
        response = FileResponse(
            iter([pdf_bytes]), content_type="application/pdf",
        )
        response["Content-Disposition"] = f'inline; filename="prescription_{prescription.pk}.pdf"'
        return response


class MyPatientsView(ListAPIView):
    """Patients a doctor treats (manager: all) — feeds the doctor's patient picker."""

    serializer_class = PatientSummarySerializer
    permission_classes = [IsDoctorOrManager]
    pagination_class = None

    def get_queryset(self):
        user = self.request.user
        if user.role == RoleChoices.DOCTOR:
            return (
                PatientProfile.objects
                .filter(treating_doctors__doctor__user=user)
                .select_related("user").distinct()
            )
        return PatientProfile.objects.select_related("user").all()
