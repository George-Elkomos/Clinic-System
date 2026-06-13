"""Staff-only views: create doctors/secretaries/patients, manage all users."""
import secrets

from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.enums import AuditAction, RoleChoices
from apps.doctors.models import DoctorProfile, Specialty

from .models import PatientProfile, User
from .permissions import IsManager, IsSecretaryOrManager
from .serializers import PatientProfileSerializer, UserSerializer
from .staff_serializers import (
    CreateDoctorSerializer,
    CreatePatientSerializer,
    CreateSecretarySerializer,
    UserManagementSerializer,
)


def _audit(actor, action, instance, request):
    try:
        from apps.audit.services import record_event
        record_event(actor=actor, action=action, instance=instance, request=request)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Doctor creation
# ---------------------------------------------------------------------------

class CreateDoctorView(APIView):
    permission_classes = [IsManager]
    parser_classes_override = None  # accept multipart via default parsers

    def post(self, request):
        ser = CreateDoctorSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data

        raw_password = d.get("password", "").strip()
        temp_password = None
        if not raw_password:
            raw_password = secrets.token_urlsafe(12)
            temp_password = raw_password

        with transaction.atomic():
            user = User(
                role=RoleChoices.DOCTOR,
                email=d["email"],
                first_name=d["first_name"],
                last_name=d["last_name"],
                phone=d.get("phone", ""),
                preferred_language=d.get("preferred_language", "en"),
            )
            user.set_password(raw_password)
            user.save()

            profile = DoctorProfile.objects.create(
                user=user,
                license_number=d["license_number"],
                room_number=d.get("room_number", ""),
                bio=d.get("bio", ""),
                photo=d.get("photo"),
            )
            specialty_ids = d.get("specialties", [])
            if specialty_ids:
                profile.specialties.set(Specialty.objects.filter(pk__in=specialty_ids))

        _audit(request.user, AuditAction.CREATE, user, request)

        from apps.doctors.serializers import DoctorProfileSerializer
        return Response(
            {
                "user": UserSerializer(user).data,
                "doctor_profile": DoctorProfileSerializer(profile).data,
                "temp_password": temp_password,
            },
            status=status.HTTP_201_CREATED,
        )


# ---------------------------------------------------------------------------
# Secretary creation
# ---------------------------------------------------------------------------

class CreateSecretaryView(APIView):
    permission_classes = [IsManager]

    def post(self, request):
        ser = CreateSecretarySerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data

        raw_password = d.get("password", "").strip()
        temp_password = None
        if not raw_password:
            raw_password = secrets.token_urlsafe(12)
            temp_password = raw_password

        with transaction.atomic():
            user = User(
                role=RoleChoices.SECRETARY,
                email=d["email"],
                first_name=d["first_name"],
                last_name=d["last_name"],
                phone=d.get("phone", ""),
                preferred_language=d.get("preferred_language", "en"),
            )
            user.set_password(raw_password)
            user.save()

        _audit(request.user, AuditAction.CREATE, user, request)

        return Response(
            {"user": UserSerializer(user).data, "temp_password": temp_password},
            status=status.HTTP_201_CREATED,
        )


# ---------------------------------------------------------------------------
# Patient creation (secretary + manager)
# ---------------------------------------------------------------------------

class CreatePatientView(APIView):
    permission_classes = [IsSecretaryOrManager]

    def post(self, request):
        ser = CreatePatientSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data

        email = d.get("email", "").strip()
        email_placeholder = False
        if not email:
            email = CreatePatientSerializer.make_placeholder_email()
            email_placeholder = True

        temp_password = secrets.token_urlsafe(12)

        with transaction.atomic():
            user = User(
                role=RoleChoices.PATIENT,
                email=email,
                first_name=d["first_name"],
                last_name=d["last_name"],
                phone=d.get("phone", ""),
            )
            user.set_password(temp_password)
            user.save()  # post_save signal auto-creates PatientProfile + NotificationPreference

            national_id = d.get("national_id", "").strip()
            if national_id:
                profile = user.patient_profile
                profile.national_id = national_id
                profile.save(update_fields=["national_id"])

        _audit(request.user, AuditAction.CREATE, user, request)

        return Response(
            {
                "user": UserSerializer(user).data,
                "patient_profile_id": user.patient_profile.pk,
                "temp_password": temp_password,
                "email_placeholder": email_placeholder,
            },
            status=status.HTTP_201_CREATED,
        )


# ---------------------------------------------------------------------------
# User list (manager sees all users by role)
# ---------------------------------------------------------------------------

class UserListView(APIView):
    permission_classes = [IsManager]

    def get(self, request):
        role = request.query_params.get("role", "").upper()
        search = request.query_params.get("search", "").strip()

        qs = User.objects.all()
        if role in RoleChoices.values:
            qs = qs.filter(role=role)
        if search:
            from django.db.models import Q
            qs = qs.filter(
                Q(first_name__icontains=search)
                | Q(last_name__icontains=search)
                | Q(email__icontains=search)
                | Q(phone__icontains=search)
            )
        qs = qs.order_by("first_name", "last_name")
        return Response(UserSerializer(qs, many=True).data)


# ---------------------------------------------------------------------------
# User edit / deactivate / reactivate / reset-password (manager)
# ---------------------------------------------------------------------------

class UserDetailView(APIView):
    permission_classes = [IsManager]

    def get_object(self, pk):
        return get_object_or_404(User, pk=pk)

    def patch(self, request, pk):
        user = self.get_object(pk)
        ser = UserManagementSerializer(user, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        _audit(request.user, AuditAction.UPDATE, user, request)
        return Response(UserSerializer(user).data)


class UserDeactivateView(APIView):
    permission_classes = [IsManager]

    def post(self, request, pk):
        user = get_object_or_404(User, pk=pk)
        user.is_active = False
        user.save(update_fields=["is_active"])
        _audit(request.user, AuditAction.UPDATE, user, request)
        return Response({"detail": "User deactivated."})


class UserReactivateView(APIView):
    permission_classes = [IsManager]

    def post(self, request, pk):
        user = get_object_or_404(User, pk=pk)
        user.is_active = True
        user.save(update_fields=["is_active"])
        _audit(request.user, AuditAction.UPDATE, user, request)
        return Response({"detail": "User reactivated."})


class UserResetPasswordView(APIView):
    permission_classes = [IsSecretaryOrManager]

    def post(self, request, pk):
        user = get_object_or_404(User, pk=pk)
        temp_password = secrets.token_urlsafe(12)
        user.set_password(temp_password)
        user.save(update_fields=["password"])
        _audit(request.user, AuditAction.UPDATE, user, request)
        return Response({"temp_password": temp_password})


# ---------------------------------------------------------------------------
# Patient profile staff edit (secretary + manager)
# ---------------------------------------------------------------------------

class PatientProfileStaffView(APIView):
    permission_classes = [IsSecretaryOrManager]

    def get_object(self, pk):
        return get_object_or_404(PatientProfile, pk=pk)

    def get(self, request, pk):
        profile = self.get_object(pk)
        return Response(PatientProfileSerializer(profile).data)

    def patch(self, request, pk):
        profile = self.get_object(pk)
        ser = PatientProfileSerializer(profile, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        _audit(request.user, AuditAction.UPDATE, profile, request)
        return Response(PatientProfileSerializer(profile).data)
