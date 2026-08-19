from rest_framework import serializers

from apps.appointments.models import Appointment
from apps.core.enums import AppointmentStatus
from apps.core.i18n import get_request_locale, localized_name

from .models import Review


class ReviewSerializer(serializers.ModelSerializer):
    patient_name = serializers.SerializerMethodField()
    doctor_name = serializers.SerializerMethodField()

    class Meta:
        model = Review
        fields = [
            "id", "patient", "patient_name", "doctor", "doctor_name", "appointment",
            "rating", "comment", "is_hidden", "created_at",
        ]
        read_only_fields = fields

    def get_patient_name(self, obj):
        locale = get_request_locale(self.context.get("request"))
        return localized_name(obj.patient.user, locale)

    def get_doctor_name(self, obj):
        locale = get_request_locale(self.context.get("request"))
        return localized_name(obj.doctor.user, locale)


class ReviewWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Review
        fields = ["id", "appointment", "rating", "comment"]
        read_only_fields = ["id"]

    def validate(self, attrs):
        patient = self.context["request"].user.patient_profile
        appointment = attrs["appointment"]
        if appointment.patient_id != patient.id:
            raise serializers.ValidationError(
                {"appointment": "You can only review your own appointments."}
            )
        if appointment.status != AppointmentStatus.COMPLETED:
            raise serializers.ValidationError(
                {"appointment": "You can only review a completed appointment."}
            )
        if Review.objects.filter(patient=patient, appointment=appointment).exists():
            raise serializers.ValidationError(
                {"appointment": "You have already reviewed this visit."}
            )
        return attrs


class ReviewModerationSerializer(serializers.ModelSerializer):
    """Manager view — includes moderation fields + reviewer/doctor names."""

    patient_name = serializers.SerializerMethodField()
    doctor_name = serializers.SerializerMethodField()

    class Meta:
        model = Review
        fields = [
            "id", "patient_name", "doctor", "doctor_name", "appointment",
            "rating", "comment", "is_hidden", "hidden_reason", "created_at",
        ]
        read_only_fields = fields

    def get_patient_name(self, obj):
        locale = get_request_locale(self.context.get("request"))
        return localized_name(obj.patient.user, locale)

    def get_doctor_name(self, obj):
        locale = get_request_locale(self.context.get("request"))
        return localized_name(obj.doctor.user, locale)


class HideReviewSerializer(serializers.Serializer):
    reason = serializers.CharField(required=False, allow_blank=True, default="")
