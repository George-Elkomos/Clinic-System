from rest_framework import serializers

from apps.medical_records.serializers import _validate_upload

from .models import RadiologyOrder, RadiologyTemplate


class RadiologyTemplateSerializer(serializers.ModelSerializer):
    class Meta:
        model = RadiologyTemplate
        fields = [
            "id", "name", "name_ar", "modality", "body_part",
            "instructions", "is_active",
        ]


class RadiologyOrderSerializer(serializers.ModelSerializer):
    patient_name = serializers.CharField(source="patient.user.get_full_name", read_only=True, default="")
    doctor_name = serializers.CharField(source="doctor.user.get_full_name", read_only=True, default="")
    template_detail = RadiologyTemplateSerializer(source="template", read_only=True)

    class Meta:
        model = RadiologyOrder
        fields = [
            "id", "accession_number", "patient", "patient_name", "doctor", "doctor_name",
            "appointment", "encounter", "template", "template_detail",
            "study_name", "study_name_ar", "clinical_reason", "priority", "status",
            "findings", "impression",
            "completed_at", "reported_at", "cancellation_reason", "cancelled_at",
            "created_at",
        ]
        read_only_fields = [
            "id", "accession_number", "doctor", "doctor_name", "patient_name", "template_detail",
            "status", "findings", "impression",
            "completed_at", "reported_at", "cancellation_reason", "cancelled_at", "created_at",
        ]

    def validate(self, attrs):
        if not self.instance:
            has_template = attrs.get("template") is not None
            has_name = bool(attrs.get("study_name", "").strip())
            if not has_template and not has_name:
                raise serializers.ValidationError(
                    "Either a template or a custom study_name is required."
                )
        return attrs


class RadiologyOrderListSerializer(serializers.ModelSerializer):
    """Lightweight list/embed view — no findings/impression."""

    patient_name = serializers.CharField(source="patient.user.get_full_name", read_only=True, default="")
    doctor_name = serializers.CharField(source="doctor.user.get_full_name", read_only=True, default="")

    class Meta:
        model = RadiologyOrder
        fields = [
            "id", "accession_number", "patient", "patient_name", "doctor", "doctor_name",
            "appointment", "encounter", "template",
            "study_name", "study_name_ar", "priority", "status",
            "completed_at", "reported_at", "created_at",
        ]


class RadiologyOrderCompleteSerializer(serializers.Serializer):
    file = serializers.FileField()
    description = serializers.CharField(required=False, allow_blank=True, default="")

    def validate_file(self, value):
        _validate_upload(value)
        return value


class RadiologyOrderReportSerializer(serializers.Serializer):
    findings = serializers.CharField()
    impression = serializers.CharField()


class RadiologyOrderCancelSerializer(serializers.Serializer):
    reason = serializers.CharField(min_length=3, max_length=500)
