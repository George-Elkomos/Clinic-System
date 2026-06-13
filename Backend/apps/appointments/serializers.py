from rest_framework import serializers

from apps.core.enums import WaitlistStatus

from .models import Appointment, FollowUp, WaitlistEntry


class AppointmentSerializer(serializers.ModelSerializer):
    patient_name = serializers.CharField(source="patient.user.get_full_name", read_only=True)
    doctor_name = serializers.CharField(source="doctor.user.get_full_name", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    type_display = serializers.CharField(source="get_appointment_type_display", read_only=True)

    class Meta:
        model = Appointment
        fields = [
            "id", "patient", "patient_name", "doctor", "doctor_name", "time_slot",
            "scheduled_start", "scheduled_end", "status", "status_display",
            "appointment_type", "type_display", "priority", "reason",
            "cancellation_reason", "checked_in_at", "started_at", "completed_at",
            "created_at",
        ]
        read_only_fields = fields


class AppointmentQueueSerializer(AppointmentSerializer):
    """Extends AppointmentSerializer with patient medical snapshot for the live queue."""

    patient_profile_id = serializers.IntegerField(source="patient.id", read_only=True)
    patient_phone = serializers.CharField(source="patient.user.phone", read_only=True)
    patient_dob = serializers.DateField(source="patient.date_of_birth", read_only=True)
    patient_gender = serializers.CharField(source="patient.gender", read_only=True)
    patient_blood_type = serializers.CharField(source="patient.blood_type", read_only=True)
    patient_allergies = serializers.CharField(source="patient.allergies_summary", read_only=True)
    patient_chronic_conditions = serializers.CharField(source="patient.chronic_conditions", read_only=True)
    patient_current_medications = serializers.CharField(source="patient.current_medications", read_only=True)

    class Meta(AppointmentSerializer.Meta):
        fields = AppointmentSerializer.Meta.fields + [
            "patient_profile_id", "patient_phone", "patient_dob", "patient_gender",
            "patient_blood_type", "patient_allergies", "patient_chronic_conditions",
            "patient_current_medications",
        ]
        read_only_fields = fields


class BookAppointmentSerializer(serializers.Serializer):
    """Patient (or staff on behalf) books an available slot."""

    slot = serializers.IntegerField()
    reason = serializers.CharField(required=False, allow_blank=True, default="")
    # Optional: staff booking for a specific patient.
    patient = serializers.IntegerField(required=False)


class CancelAppointmentSerializer(serializers.Serializer):
    reason = serializers.CharField(required=False, allow_blank=True, default="")


class WalkInSerializer(serializers.Serializer):
    patient = serializers.IntegerField()
    doctor = serializers.IntegerField()
    reason = serializers.CharField(required=False, allow_blank=True, default="")
    emergency = serializers.BooleanField(required=False, default=False)


class WaitlistEntrySerializer(serializers.ModelSerializer):
    patient_name = serializers.CharField(source="patient.user.get_full_name", read_only=True)
    doctor_name = serializers.CharField(source="doctor.user.get_full_name", read_only=True)

    class Meta:
        model = WaitlistEntry
        fields = [
            "id", "patient", "patient_name", "doctor", "doctor_name",
            "desired_date_from", "desired_date_to", "status", "position", "created_at",
        ]
        read_only_fields = ["id", "patient", "patient_name", "doctor_name", "status", "position", "created_at"]

    def validate_status(self, value):
        return WaitlistStatus.WAITING


class FollowUpSerializer(serializers.ModelSerializer):
    doctor_name = serializers.CharField(source="doctor.user.get_full_name", read_only=True)
    patient_name = serializers.CharField(source="patient.user.get_full_name", read_only=True)
    suggested_start = serializers.DateTimeField(source="suggested_slot.start_datetime", read_only=True, default=None)
    status_display = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = FollowUp
        fields = [
            "id", "origin_appointment", "patient", "patient_name", "doctor", "doctor_name",
            "recommended_date", "suggested_slot", "suggested_start", "resulting_appointment",
            "status", "status_display", "notes", "created_at",
        ]
        read_only_fields = fields


class FollowUpCreateSerializer(serializers.Serializer):
    origin_appointment = serializers.IntegerField()
    recommended_date = serializers.DateField()
    notes = serializers.CharField(required=False, allow_blank=True, default="")


class KioskQueueRowSerializer(serializers.Serializer):
    position = serializers.IntegerField()
    display_name = serializers.CharField()
    status = serializers.CharField()
    scheduled_start = serializers.DateTimeField()
    is_emergency = serializers.BooleanField()
    is_walk_in = serializers.BooleanField()
