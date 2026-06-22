from django.db.models import Count, Q
from django.http import FileResponse
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.generics import ListAPIView, get_object_or_404
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.enums import RoleChoices
from apps.core.pagination import DefaultPagination
from apps.users.models import PatientProfile
from apps.users.permissions import IsDoctorOrManager

from .models import ClinicalNote, LabOrder, LabResult, MedicalRecord, Prescription, Scan
from .permissions import ClinicalNotePermission, LabOrderPermission, MedicalDataPermission, doctor_treats
from .serializers import (
    ClinicalNoteSerializer,
    LabOrderCancelSerializer,
    LabOrderListSerializer,
    LabOrderResultSerializer,
    LabOrderSerializer,
    LabResultSerializer,
    MedicalRecordSerializer,
    PatientSummarySerializer,
    PrescriptionSerializer,
    ScanSerializer,
)
from .services import lab_orders as lab_order_service
from .services.pdf import render_prescription_pdf
from .services.records import create_record_version
from .services.timeline import build_patient_timeline


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


class LabOrderViewSet(viewsets.ModelViewSet):
    permission_classes = [LabOrderPermission]
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]
    filterset_fields = ["patient", "doctor", "status", "priority"]

    def get_queryset(self):
        user = self.request.user
        # ARCH-6: annotate item_count once here so LabOrderListSerializer can
        # read obj.item_count without firing a COUNT query per row.
        # distinct=True prevents double-counting when the doctor join multiplies rows.
        qs = LabOrder.objects.select_related(
            "patient__user", "doctor__user", "appointment"
        ).prefetch_related("items", "results").annotate(
            item_count=Count("items", distinct=True)
        )

        if user.role in (RoleChoices.MANAGER, RoleChoices.SECRETARY):
            return qs.order_by("-created_at")
        if user.role == RoleChoices.PATIENT:
            return qs.filter(patient__user=user).order_by("-created_at")
        if user.role == RoleChoices.DOCTOR:
            return (
                qs.filter(
                    Q(doctor__user=user) |
                    Q(patient__treating_doctors__doctor__user=user)
                )
                .distinct()
                .order_by("-created_at")
            )
        return qs.none()

    def get_serializer_class(self):
        if self.action == "list":
            return LabOrderListSerializer
        return LabOrderSerializer

    def perform_create(self, serializer):
        user = self.request.user
        if user.role != RoleChoices.DOCTOR:
            raise PermissionDenied("Only doctors can create lab orders.")
        patient = serializer.validated_data.get("patient")
        if patient and not doctor_treats(user, patient):
            raise PermissionDenied("You can only order labs for your own patients.")
        serializer.save(doctor=user.doctor_profile)

    def destroy(self, request, *args, **kwargs):
        order = self.get_object()
        order.soft_delete()
        return Response(status=204)

    @action(detail=True, methods=["post"])
    def submit(self, request, pk=None):
        order = self.get_object()
        if order.doctor.user_id != request.user.id and request.user.role != RoleChoices.MANAGER:
            raise PermissionDenied("Only the ordering doctor can submit this order.")
        result = lab_order_service.submit_order(order)
        return Response(LabOrderSerializer(result).data)

    @action(detail=True, methods=["post"], url_path="collect-sample")
    def collect_sample(self, request, pk=None):
        if request.user.role not in (RoleChoices.SECRETARY, RoleChoices.MANAGER):
            raise PermissionDenied("Only lab staff can collect samples.")
        order = self.get_object()
        result = lab_order_service.collect_sample(order)
        return Response(LabOrderSerializer(result).data)

    @action(detail=True, methods=["post"], url_path="start-processing")
    def start_processing(self, request, pk=None):
        if request.user.role not in (RoleChoices.SECRETARY, RoleChoices.MANAGER):
            raise PermissionDenied("Only lab staff can start processing.")
        order = self.get_object()
        result = lab_order_service.start_processing(order)
        return Response(LabOrderSerializer(result).data)

    @action(detail=True, methods=["post"], url_path="enter-results",
            parser_classes=[MultiPartParser, FormParser, JSONParser])
    def enter_results(self, request, pk=None):
        if request.user.role not in (RoleChoices.SECRETARY, RoleChoices.MANAGER):
            raise PermissionDenied("Only lab staff can enter results.")
        order = self.get_object()
        results_data = request.data.get("results", [])
        if not isinstance(results_data, list):
            raise ValidationError({"results": "Expected a list of result objects."})
        serializer = LabOrderResultSerializer(data=results_data, many=True)
        serializer.is_valid(raise_exception=True)
        result_order = lab_order_service.complete_order(
            order, serializer.validated_data, entered_by=request.user
        )
        return Response(LabOrderSerializer(result_order).data)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        order = self.get_object()
        if order.doctor.user_id != request.user.id and request.user.role != RoleChoices.MANAGER:
            raise PermissionDenied("Only the ordering doctor or a manager can cancel this order.")
        serializer = LabOrderCancelSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = lab_order_service.cancel_order(
            order,
            reason=serializer.validated_data["cancellation_reason"],
            cancelled_by=request.user,
        )
        return Response(LabOrderSerializer(result, context={"request": request}).data)

    @action(detail=True, methods=["post"])
    def review(self, request, pk=None):
        order = self.get_object()
        if order.doctor.user_id != request.user.id and request.user.role != RoleChoices.MANAGER:
            raise PermissionDenied("Only the ordering doctor can mark results as reviewed.")
        result = lab_order_service.review_order(order)
        return Response(LabOrderSerializer(result).data)

    @action(detail=True, methods=["get"], url_path=r"results/(?P<result_pk>\d+)/download")
    def download_result_file(self, request, pk=None, result_pk=None):
        from .models import LabOrderResult
        order = self.get_object()
        try:
            lab_result = order.results.get(pk=result_pk)
        except LabOrderResult.DoesNotExist:
            raise ValidationError({"detail": "Result not found."})
        if not lab_result.file:
            raise ValidationError({"file": "No file attached to this result."})
        return FileResponse(
            lab_result.file.open("rb"), as_attachment=True,
            filename=lab_result.file.name.split("/")[-1],
        )


class PatientTimelineView(APIView):
    """GET /api/patients/{id}/timeline/ — unified chronological history feed.

    RBAC: patient (own only), treating doctor, manager. Secretaries are denied.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, pk=None):
        patient = get_object_or_404(PatientProfile, pk=pk)
        user = request.user

        if user.role == RoleChoices.SECRETARY:
            raise PermissionDenied("Secretaries cannot view patient timelines.")
        if user.role == RoleChoices.PATIENT and patient.user_id != user.id:
            raise PermissionDenied("You can only view your own history.")
        if user.role == RoleChoices.DOCTOR and not doctor_treats(user, patient):
            raise PermissionDenied("You can only view your own patients' history.")
        # MANAGER falls through with full access.

        types_param = request.query_params.get("types")
        types = [t.strip() for t in types_param.split(",") if t.strip()] if types_param else None

        events = build_patient_timeline(
            patient,
            types=types,
            date_from=request.query_params.get("date_from"),
            date_to=request.query_params.get("date_to"),
        )

        paginator = DefaultPagination()
        page = paginator.paginate_queryset(events, request, view=self)
        return paginator.get_paginated_response(page)


