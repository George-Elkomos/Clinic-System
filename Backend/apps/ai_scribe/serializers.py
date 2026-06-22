from rest_framework import serializers

from .models import SessionRecording
from .services.schema import normalize_draft


class SessionUploadSerializer(serializers.ModelSerializer):
    """Inbound multipart payload when a doctor records/uploads a session."""

    class Meta:
        model = SessionRecording
        fields = ["id", "patient", "appointment", "audio", "language"]

    def validate_audio(self, f):
        from django.conf import settings
        max_bytes = settings.AI_SCRIBE_MAX_AUDIO_MB * 1024 * 1024
        if f.size > max_bytes:
            raise serializers.ValidationError(
                f"Audio is too large (max {settings.AI_SCRIBE_MAX_AUDIO_MB} MB)."
            )
        return f


class SessionSerializer(serializers.ModelSerializer):
    """Outbound representation the frontend polls and renders."""

    patient_name = serializers.CharField(source="patient.user.get_full_name", read_only=True)
    doctor_name = serializers.CharField(source="doctor.user.get_full_name", read_only=True)

    class Meta:
        model = SessionRecording
        fields = [
            "id", "patient", "patient_name", "doctor", "doctor_name", "appointment",
            "language", "status", "error", "transcript", "segments", "extracted",
            "original_filename", "file_size",
            "committed_record", "committed_prescription",
            "created_at", "processing_started_at", "processing_finished_at", "committed_at",
        ]
        read_only_fields = fields


class CommitSerializer(serializers.Serializer):
    """The doctor's reviewed draft, submitted to write real clinical rows."""

    draft = serializers.JSONField()
    create_prescription = serializers.BooleanField(default=True)

    def validate_draft(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError("draft must be an object.")
        return normalize_draft(value)
