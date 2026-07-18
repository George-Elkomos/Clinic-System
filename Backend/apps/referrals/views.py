from django.db.models import Q
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from apps.core.enums import RoleChoices

from . import services
from .models import Referral
from .permissions import ReferralPermission
from .serializers import ReferralCreateSerializer, ReferralLimitedSerializer, ReferralReadSerializer

_REFERRAL_RELATIONS = (
    "patient__user", "referring_doctor__user", "target_doctor__user",
    "accepted_by__user", "specialty__category", "encounter",
)


class ReferralViewSet(viewsets.ModelViewSet):
    permission_classes = [ReferralPermission]
    http_method_names = ["get", "post", "head", "options"]
    filterset_fields = ["patient", "referring_doctor", "target_doctor", "status", "referral_type"]

    def get_queryset(self):
        user = self.request.user
        qs = Referral.objects.select_related(*_REFERRAL_RELATIONS)
        if user.role in (RoleChoices.MANAGER, RoleChoices.SECRETARY):
            return qs
        if user.role == RoleChoices.PATIENT:
            return qs.filter(patient__user=user)
        if user.role == RoleChoices.DOCTOR:
            doctor_profile = getattr(user, "doctor_profile", None)
            if doctor_profile is None:
                return qs.none()
            return qs.filter(
                Q(referring_doctor__user=user)
                | Q(target_doctor__user=user)
                | Q(accepted_by__user=user)
                | Q(target_doctor__isnull=True, specialty__in=doctor_profile.specialties.all())
            ).distinct()
        return qs.none()

    def get_serializer_class(self):
        if self.action == "create":
            return ReferralCreateSerializer
        if self.request.user.role == RoleChoices.SECRETARY:
            return ReferralLimitedSerializer
        return ReferralReadSerializer

    def perform_create(self, serializer):
        user = self.request.user
        if user.role != RoleChoices.DOCTOR:
            raise PermissionDenied("Only doctors can create referrals.")
        referral = services.create_referral(
            doctor=user.doctor_profile, **serializer.validated_data
        )
        serializer.instance = referral

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        return Response(ReferralReadSerializer(serializer.instance).data, status=201)

    @action(detail=True, methods=["post"])
    def accept(self, request, pk=None):
        referral = self.get_object()
        result = services.accept_referral(referral, request.user.doctor_profile)
        return Response(ReferralReadSerializer(result).data)

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        referral = self.get_object()
        result = services.complete_referral(referral, request.user.doctor_profile)
        return Response(ReferralReadSerializer(result).data)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        referral = self.get_object()
        result = services.cancel_referral(referral, request.user)
        return Response(ReferralReadSerializer(result).data)
