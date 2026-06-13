from django.db.models import Avg, Count, Q
from rest_framework import mixins, viewsets
from rest_framework.generics import ListAPIView
from rest_framework.permissions import AllowAny

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


class WorkingScheduleViewSet(viewsets.ModelViewSet):
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


class DoctorAbsenceViewSet(viewsets.ModelViewSet):
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
    """Future AVAILABLE slots for a doctor (the patient booking calendar feed).
    Required query param: ?doctor=<id>. Optional: ?date=YYYY-MM-DD."""

    serializer_class = TimeSlotSerializer
    permission_classes = [AllowAny]
    filterset_fields = ["date"]
    pagination_class = None

    def get_queryset(self):
        from django.utils import timezone

        qs = TimeSlot.objects.filter(
            status=SlotStatus.AVAILABLE, start_datetime__gte=timezone.now()
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
