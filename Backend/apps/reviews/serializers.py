from rest_framework import serializers

from apps.appointments.models import Appointment
from apps.core.enums import AppointmentStatus

from .models import Review


class ReviewSerializer(serializers.ModelSerializer):
    patient_name = serializers.CharField(source="patient.user.get_full_name", read_only=True)
    doctor_name = serializers.CharField(source="doctor.user.get_full_name", read_only=True)

    class Meta:
        model = Review
        fields = [
            "id", "patient", "patient_name", "doctor", "doctor_name", "appointment",
            "rating", "comment", "is_hidden", "created_at",
        ]
        read_only_fields = fields


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

    patient_name = serializers.CharField(source="patient.user.get_full_name", read_only=True)
    doctor_name = serializers.CharField(source="doctor.user.get_full_name", read_only=True)

    class Meta:
        model = Review
        fields = [
            "id", "patient_name", "doctor", "doctor_name", "appointment",
            "rating", "comment", "is_hidden", "hidden_reason", "created_at",
        ]
        read_only_fields = fields


class HideReviewSerializer(serializers.Serializer):
    reason = serializers.CharField(required=False, allow_blank=True, default="")
