from django.db.models import Avg, Count, Q
from rest_framework import mixins, status, viewsets
from rest_framework.generics import ListAPIView
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from apps.core.enums import RoleChoices, SlotStatus
from apps.users.permissions import ReadOnlyOrManager

from .models import (
    DoctorAbsence,
    DoctorProfile,
    Specialty,
    SpecialtyCategory,
    TimeSlot,
    WorkingSchedule,
)
from .permissions import DoctorProfilePermission, OwnsDoctorResource
from .serializers import (
    DoctorAbsenceSerializer,
    DoctorProfileSerializer,
    DoctorProfileWriteSerializer,
    PublicDoctorSerializer,
    SpecialtyCategorySerializer,
    SpecialtySerializer,
    TimeSlotSerializer,
    WorkingScheduleSerializer,
)


class SpecialtyCategoryViewSet(viewsets.ModelViewSet):
    queryset = SpecialtyCategory.objects.all()
    serializer_class = SpecialtyCategorySerializer
    permission_classes = [ReadOnlyOrManager]


class SpecialtyViewSet(viewsets.ModelViewSet):
    queryset = Specialty.objects.select_related("category").all()
    serializer_class = SpecialtySerializer
    permission_classes = [ReadOnlyOrManager]
    filterset_fields = ["category", "is_active"]
    search_fields = ["name", "name_ar"]


class DoctorProfileViewSet(viewsets.ModelViewSet):
    queryset = DoctorProfile.objects.select_related("user").prefetch_related(
        "specialties__category"
    )
    permission_classes = [DoctorProfilePermission]
    filterset_fields = ["specialties", "is_accepting_patients"]
    search_fields = ["user__first_name", "user__last_name", "specialties__name"]

    def get_serializer_class(self):
        if self.action in ("update", "partial_update"):
            return DoctorProfileWriteSerializer
        return DoctorProfileSerializer


class DoctorSelfServiceCreateMixin:
    """`doctor` is a required, writable field on these serializers (secretary/
    manager must say which doctor they're acting on behalf of). But a DOCTOR
    submitting their own schedule/absence never sends it, and DRF validates
    the payload — rejecting the missing required field — before
    perform_create() ever runs, so perform_create()'s own `doctor=user.
    doctor_profile` injection was unreachable dead code. Fill it in here,
    before validation, instead."""

    def create(self, request, *args, **kwargs):
        data = request.data
        if request.user.role == RoleChoices.DOCTOR:
            data = request.data.copy()
            data["doctor"] = request.user.doctor_profile.id
        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        headers = self.get_success_headers(serializer.data)
        return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)


class WorkingScheduleViewSet(DoctorSelfServiceCreateMixin, viewsets.ModelViewSet):
    serializer_class = WorkingScheduleSerializer
    permission_classes = [OwnsDoctorResource]
    filterset_fields = ["doctor", "weekday", "is_active"]

    def get_queryset(self):
        qs = WorkingSchedule.objects.select_related("doctor__user")
        user = self.request.user
        if user.role == RoleChoices.DOCTOR:
            return qs.filter(doctor__user=user)
        return qs  # secretary/manager see all (filter with ?doctor=)

    def perform_create(self, serializer):
        user = self.request.user
        if user.role == RoleChoices.DOCTOR:
            serializer.save(doctor=user.doctor_profile)
        else:
            serializer.save()


class DoctorAbsenceViewSet(DoctorSelfServiceCreateMixin, viewsets.ModelViewSet):
    serializer_class = DoctorAbsenceSerializer
    permission_classes = [OwnsDoctorResource]
    filterset_fields = ["doctor", "absence_type"]

    def get_queryset(self):
        qs = DoctorAbsence.objects.select_related("doctor__user", "created_by")
        user = self.request.user
        if user.role == RoleChoices.DOCTOR:
            return qs.filter(doctor__user=user)
        return qs

    def perform_create(self, serializer):
        user = self.request.user
        if user.role == RoleChoices.DOCTOR:
            serializer.save(doctor=user.doctor_profile, created_by=user)
        else:
            serializer.save(created_by=user)


class AvailableSlotsView(ListAPIView):
    """Future slots for a doctor (the patient booking calendar feed).
    Required query param: ?doctor=<id>. Optional: ?date=YYYY-MM-DD.

    Returns only AVAILABLE slots by default. Pass ?include_booked=true to
    also get already-BOOKED ones (still carrying their real `status`) so a
    caller can render them as a disabled/greyed option instead of just
    omitting them — used by the patient booking page so a taken time doesn't
    silently vanish from the grid."""

    serializer_class = TimeSlotSerializer
    permission_classes = [AllowAny]
    filterset_fields = ["date"]
    pagination_class = None

    def get_queryset(self):
        from django.utils import timezone

        statuses = [SlotStatus.AVAILABLE]
        if self.request.query_params.get("include_booked") == "true":
            statuses.append(SlotStatus.BOOKED)
        qs = TimeSlot.objects.filter(
            status__in=statuses, start_datetime__gte=timezone.now()
        )
        doctor_id = self.request.query_params.get("doctor")
        if doctor_id:
            qs = qs.filter(doctor_id=doctor_id)
        date = self.request.query_params.get("date")
        if date:
            qs = qs.filter(date=date)
        return qs.order_by("start_datetime")


class PublicDoctorViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """No-login doctor directory with aggregate rating + availability."""

    permission_classes = [AllowAny]
    serializer_class = PublicDoctorSerializer
    filterset_fields = {
        "specialties": ["exact"],
        "languages_spoken": ["icontains"],
        "is_accepting_patients": ["exact"],
    }
    search_fields = ["user__first_name", "user__last_name", "specialties__name"]

    def get_queryset(self):
        return (
            DoctorProfile.objects.select_related("user")
            .prefetch_related("specialties__category", "time_slots")
            .annotate(
                average_rating=Avg("reviews__rating", filter=Q(reviews__is_hidden=False)),
                review_count=Count("reviews", filter=Q(reviews__is_hidden=False)),
            )
            .order_by("-average_rating", "user__first_name")
        )
