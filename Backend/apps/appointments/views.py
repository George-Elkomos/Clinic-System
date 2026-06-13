from django.db.models import Q
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.generics import ListAPIView, get_object_or_404
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.enums import AppointmentStatus, AppointmentType, RoleChoices
from apps.doctors.models import DoctorProfile
from apps.medical_records.serializers import PatientSummarySerializer
from apps.users.models import PatientProfile
from apps.users.permissions import IsSecretaryOrManager

from . import services
from .models import Appointment, FollowUp, WaitlistEntry
from .permissions import AppointmentPermission
from .serializers import (
    AppointmentQueueSerializer,
    AppointmentSerializer,
    BookAppointmentSerializer,
    CancelAppointmentSerializer,
    FollowUpCreateSerializer,
    FollowUpSerializer,
    KioskQueueRowSerializer,
    WaitlistEntrySerializer,
    WalkInSerializer,
)

STAFF_ROLES = (RoleChoices.SECRETARY, RoleChoices.MANAGER)


class AppointmentViewSet(viewsets.ModelViewSet):
    serializer_class = AppointmentSerializer
    permission_classes = [AppointmentPermission]
    http_method_names = ["get", "post", "patch", "head", "options"]
    filterset_fields = ["status", "doctor", "appointment_type"]

    def get_queryset(self):
        qs = Appointment.objects.select_related(
            "patient__user", "doctor__user", "time_slot"
        )
        user = self.request.user
        if user.role == RoleChoices.PATIENT:
            qs = qs.filter(patient__user=user)
        elif user.role == RoleChoices.DOCTOR:
            qs = qs.filter(doctor__user=user)
        # secretary / manager: unscoped
        date = self.request.query_params.get("date")
        if date:
            qs = qs.filter(scheduled_start__date=date)
        return qs

    def create(self, request, *args, **kwargs):
        serializer = BookAppointmentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        user = request.user

        if user.role == RoleChoices.PATIENT:
            patient = getattr(user, "patient_profile", None)
            if patient is None:
                raise ValidationError({"detail": "Your patient profile is missing."})
        elif user.role in STAFF_ROLES:
            if not data.get("patient"):
                raise ValidationError({"patient": "Select a patient to book for."})
            patient = get_object_or_404(PatientProfile, pk=data["patient"])
        else:
            raise PermissionDenied("Doctors cannot create bookings here.")

        appointment = services.book_slot(
            patient=patient,
            slot_id=data["slot"],
            reason=data.get("reason", ""),
            created_by=user,
            appointment_type=AppointmentType.SCHEDULED,
        )
        return Response(
            AppointmentSerializer(appointment).data, status=status.HTTP_201_CREATED
        )

    @action(detail=True, methods=["post"])
    def confirm(self, request, pk=None):
        if request.user.role not in STAFF_ROLES:
            raise PermissionDenied("Only the front desk can confirm appointments.")
        appointment = self.get_object()
        services.confirm_appointment(appointment)
        return Response(AppointmentSerializer(appointment).data)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        appointment = self.get_object()
        serializer = CancelAppointmentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        enforce_window = request.user.role == RoleChoices.PATIENT
        services.cancel_appointment(
            appointment,
            cancelled_by=request.user,
            reason=serializer.validated_data.get("reason", ""),
            enforce_window=enforce_window,
        )
        return Response(AppointmentSerializer(appointment).data)

    def _staff_or_owning_doctor(self, appointment):
        user = self.request.user
        if user.role in STAFF_ROLES:
            return
        if user.role == RoleChoices.DOCTOR and appointment.doctor.user_id == user.id:
            return
        raise PermissionDenied("You cannot change this appointment's status.")

    @action(detail=True, methods=["post"], url_path="check-in")
    def check_in(self, request, pk=None):
        appointment = self.get_object()
        self._staff_or_owning_doctor(appointment)
        appointment.status = AppointmentStatus.CHECKED_IN
        appointment.checked_in_at = timezone.now()
        appointment.save(update_fields=["status", "checked_in_at", "updated_at"])
        return Response(AppointmentSerializer(appointment).data)

    @action(detail=True, methods=["post"])
    def start(self, request, pk=None):
        appointment = self.get_object()
        self._staff_or_owning_doctor(appointment)
        appointment.status = AppointmentStatus.IN_PROGRESS
        appointment.started_at = timezone.now()
        appointment.save(update_fields=["status", "started_at", "updated_at"])
        return Response(AppointmentSerializer(appointment).data)

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        appointment = self.get_object()
        self._staff_or_owning_doctor(appointment)
        services.complete_appointment(appointment)
        return Response(AppointmentSerializer(appointment).data)

    @action(detail=False, methods=["post"], url_path="walk-in")
    def walk_in(self, request):
        if request.user.role not in STAFF_ROLES:
            raise PermissionDenied("Only the front desk can add walk-ins.")
        serializer = WalkInSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        patient = get_object_or_404(PatientProfile, pk=data["patient"])
        doctor = get_object_or_404(DoctorProfile, pk=data["doctor"])
        appointment = services.create_walk_in(
            patient=patient, doctor=doctor, reason=data.get("reason", ""),
            created_by=request.user, emergency=data.get("emergency", False),
        )
        return Response(AppointmentSerializer(appointment).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="mark-emergency")
    def mark_emergency(self, request, pk=None):
        if request.user.role not in STAFF_ROLES:
            raise PermissionDenied("Only the front desk can flag emergencies.")
        appointment = self.get_object()
        appointment.appointment_type = AppointmentType.EMERGENCY
        appointment.priority = 10
        appointment.save(update_fields=["appointment_type", "priority", "updated_at"])
        return Response(AppointmentSerializer(appointment).data)

    @action(detail=True, methods=["post"], url_path="no-show")
    def no_show(self, request, pk=None):
        appointment = self.get_object()
        self._staff_or_owning_doctor(appointment)
        active = [AppointmentStatus.CONFIRMED, AppointmentStatus.CHECKED_IN, AppointmentStatus.IN_PROGRESS]
        if appointment.status not in active:
            raise ValidationError({"detail": "Cannot mark as no-show from this status."})
        appointment.status = AppointmentStatus.NO_SHOW
        appointment.save(update_fields=["status", "updated_at"])
        return Response(AppointmentSerializer(appointment).data)

    @action(detail=False, methods=["get"], url_path="my-queue")
    def my_queue(self, request):
        """Doctor's live queue: previous, current, and next appointment with patient details."""
        if request.user.role != RoleChoices.DOCTOR:
            raise PermissionDenied("Only doctors can view the live queue.")
        today = timezone.now().date()
        by_doctor = Appointment.objects.select_related(
            "patient__user", "doctor__user", "time_slot"
        ).filter(doctor__user=request.user)
        today_qs = by_doctor.filter(scheduled_start__date=today)

        # current: any IN_PROGRESS for this doctor regardless of date
        current = by_doctor.filter(
            status=AppointmentStatus.IN_PROGRESS
        ).order_by("-started_at").first()
        # next: soonest waiting appointment scheduled today or earlier
        next_appt = by_doctor.filter(
            status__in=[AppointmentStatus.CHECKED_IN, AppointmentStatus.CONFIRMED],
            scheduled_start__date__lte=today,
        ).order_by("-priority", "scheduled_start").first()
        # previous: most recently completed today
        previous = today_qs.filter(
            status=AppointmentStatus.COMPLETED
        ).order_by("-completed_at").first()
        waiting_count = by_doctor.filter(
            status__in=[AppointmentStatus.CHECKED_IN, AppointmentStatus.CONFIRMED],
            scheduled_start__date__lte=today,
        ).count()

        ser = AppointmentQueueSerializer
        return Response({
            "previous": ser(previous).data if previous else None,
            "current": ser(current).data if current else None,
            "next": ser(next_appt).data if next_appt else None,
            "waiting_count": waiting_count,
        })

    @action(detail=True, methods=["get"], url_path="queue-position")
    def queue_position(self, request, pk=None):
        """Queue position for a specific appointment (patient self-check or staff)."""
        appt = self.get_object()
        if request.user.role == RoleChoices.PATIENT and appt.patient.user != request.user:
            raise PermissionDenied()
        today = appt.scheduled_start.date()
        waiting = [AppointmentStatus.CHECKED_IN, AppointmentStatus.CONFIRMED]
        ahead = Appointment.objects.filter(
            doctor=appt.doctor, scheduled_start__date=today, status__in=waiting,
        ).filter(
            Q(priority__gt=appt.priority) |
            Q(priority=appt.priority, scheduled_start__lt=appt.scheduled_start)
        ).count()
        total_waiting = Appointment.objects.filter(
            doctor=appt.doctor, scheduled_start__date=today, status__in=waiting,
        ).count()
        avg_min = appt.doctor.avg_appointment_duration or 15
        in_progress = Appointment.objects.filter(
            doctor=appt.doctor, scheduled_start__date=today,
            status=AppointmentStatus.IN_PROGRESS,
        ).first()
        estimated = ahead * avg_min
        if in_progress and in_progress.started_at:
            elapsed = (timezone.now() - in_progress.started_at).total_seconds() / 60
            estimated += max(0.0, avg_min - elapsed)
        return Response({
            "position": ahead + 1,
            "total_waiting": total_waiting,
            "status": appt.status,
            "estimated_wait_minutes": round(estimated),
            "in_progress": in_progress is not None,
        })


class WaitlistEntryViewSet(viewsets.ModelViewSet):
    serializer_class = WaitlistEntrySerializer
    permission_classes = [AppointmentPermission]
    http_method_names = ["get", "post", "delete", "head", "options"]
    filterset_fields = ["doctor", "status"]

    def get_queryset(self):
        qs = WaitlistEntry.objects.select_related("patient__user", "doctor__user")
        user = self.request.user
        if user.role == RoleChoices.PATIENT:
            return qs.filter(patient__user=user)
        return qs

    def perform_create(self, serializer):
        user = self.request.user
        if user.role == RoleChoices.PATIENT:
            serializer.save(patient=user.patient_profile)
        else:
            raise PermissionDenied("Only patients can join a waitlist here.")


class FollowUpViewSet(viewsets.ModelViewSet):
    """Follow-up scheduling: doctors suggest, patients confirm/dismiss."""

    serializer_class = FollowUpSerializer
    permission_classes = [AppointmentPermission]
    http_method_names = ["get", "post", "head", "options"]
    filterset_fields = ["doctor", "patient", "status"]

    def get_queryset(self):
        qs = FollowUp.objects.select_related(
            "patient__user", "doctor__user", "suggested_slot"
        )
        user = self.request.user
        if user.role == RoleChoices.PATIENT:
            return qs.filter(patient__user=user)
        if user.role == RoleChoices.DOCTOR:
            return qs.filter(doctor__user=user)
        return qs

    def create(self, request, *args, **kwargs):
        if request.user.role not in (RoleChoices.DOCTOR, *STAFF_ROLES):
            raise PermissionDenied("Only clinical staff can suggest follow-ups.")
        serializer = FollowUpCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        origin = get_object_or_404(Appointment, pk=serializer.validated_data["origin_appointment"])
        if request.user.role == RoleChoices.DOCTOR and origin.doctor.user_id != request.user.id:
            raise PermissionDenied("You can only create follow-ups for your own patients.")
        followup = services.create_followup(
            origin_appointment=origin,
            recommended_date=serializer.validated_data["recommended_date"],
            notes=serializer.validated_data.get("notes", ""),
            created_by=request.user,
        )
        return Response(FollowUpSerializer(followup).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def confirm(self, request, pk=None):
        followup = self.get_object()
        if request.user.role == RoleChoices.PATIENT and followup.patient.user_id != request.user.id:
            raise PermissionDenied("You can only confirm your own follow-ups.")
        appointment = services.confirm_followup(followup, created_by=request.user)
        return Response(AppointmentSerializer(appointment).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def dismiss(self, request, pk=None):
        followup = self.get_object()
        services.dismiss_followup(followup)
        return Response(FollowUpSerializer(followup).data)


def _kiosk_display_name(user):
    first = user.first_name or "Patient"
    last_initial = (user.last_name[:1] + ".") if user.last_name else ""
    return f"{first} {last_initial}".strip()


class KioskQueueView(APIView):
    """Public, no-login waiting-room display for one doctor (module 5).
    Returns who is being seen now + the next few patients, privacy-masked."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request, doctor_id):
        doctor = get_object_or_404(DoctorProfile.objects.select_related("user"), pk=doctor_id)
        today = timezone.localdate()
        active = (
            Appointment.objects.select_related("patient__user")
            .filter(
                doctor=doctor,
                scheduled_start__date=today,
                status__in=[
                    AppointmentStatus.CONFIRMED,
                    AppointmentStatus.CHECKED_IN,
                    AppointmentStatus.IN_PROGRESS,
                ],
            )
            .order_by("-priority", "scheduled_start")
        )

        now_serving = None
        rows = []
        position = 0
        for appt in active:
            is_emergency = appt.appointment_type == AppointmentType.EMERGENCY
            is_walk_in = appt.appointment_type == AppointmentType.WALK_IN
            row = {
                "position": position,
                "display_name": _kiosk_display_name(appt.patient.user),
                "status": appt.status,
                "scheduled_start": appt.scheduled_start,
                "is_emergency": is_emergency,
                "is_walk_in": is_walk_in,
            }
            if appt.status == AppointmentStatus.IN_PROGRESS and now_serving is None:
                now_serving = row
            else:
                position += 1
                row["position"] = position
                rows.append(row)

        return Response({
            "doctor": {
                "id": doctor.id,
                "name": str(doctor),
                "room_number": doctor.room_number,
            },
            "now_serving": KioskQueueRowSerializer(now_serving).data if now_serving else None,
            "queue": KioskQueueRowSerializer(rows[:5], many=True).data,
            "waiting_count": len(rows),
            "generated_at": timezone.now(),
        })


class PatientDirectoryView(ListAPIView):
    """Patient lookup for the walk-in picker (secretary/manager). ?search= filters."""

    serializer_class = PatientSummarySerializer
    permission_classes = [IsSecretaryOrManager]
    pagination_class = None

    def get_queryset(self):
        qs = PatientProfile.objects.select_related("user")
        search = self.request.query_params.get("search")
        if search:
            qs = qs.filter(
                Q(user__first_name__icontains=search)
                | Q(user__last_name__icontains=search)
                | Q(user__email__icontains=search)
                | Q(user__phone__icontains=search)
                | Q(national_id__icontains=search)
            )
        return qs.order_by("user__first_name", "user__last_name")
