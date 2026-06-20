from rest_framework import serializers

from .models import VitalSigns


class VitalSignsReadSerializer(serializers.ModelSerializer):
    """Full read-only representation returned by GET endpoints."""

    bmi = serializers.SerializerMethodField()
    recorded_by_name = serializers.SerializerMethodField()

    class Meta:
        model = VitalSigns
        fields = [
            "id",
            "patient",
            "appointment",
            "recorded_by",
            "recorded_by_name",
            "bp_systolic",
            "bp_diastolic",
            "heart_rate",
            "temperature",
            "respiratory_rate",
            "oxygen_saturation",
            "weight",
            "height",
            "bmi",
            "blood_glucose",
            "notes",
            "created_at",
        ]
        read_only_fields = fields

    def get_bmi(self, obj):
        return obj.bmi

    def get_recorded_by_name(self, obj):
        if obj.recorded_by:
            return obj.recorded_by.get_full_name() or obj.recorded_by.email
        return ""


class VitalSignsWriteSerializer(serializers.ModelSerializer):
    """Input serializer for POST (create) and PATCH (update)."""

    bmi = serializers.SerializerMethodField(read_only=True)
    recorded_by_name = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = VitalSigns
        fields = [
            "id",
            "patient",
            "appointment",
            "recorded_by",
            "recorded_by_name",
            "bp_systolic",
            "bp_diastolic",
            "heart_rate",
            "temperature",
            "respiratory_rate",
            "oxygen_saturation",
            "weight",
            "height",
            "bmi",
            "blood_glucose",
            "notes",
            "created_at",
        ]
        read_only_fields = ["id", "recorded_by", "recorded_by_name", "bmi", "created_at"]

    def get_bmi(self, obj):
        return obj.bmi

    def get_recorded_by_name(self, obj):
        if obj.recorded_by:
            return obj.recorded_by.get_full_name() or obj.recorded_by.email
        return ""

    def validate_height(self, value):
        if value == 0:
            raise serializers.ValidationError("Height cannot be zero.")
        return value

    def validate(self, attrs):
        # Cross-field: diastolic must be less than systolic.
        bp_s = attrs.get("bp_systolic", getattr(self.instance, "bp_systolic", None))
        bp_d = attrs.get("bp_diastolic", getattr(self.instance, "bp_diastolic", None))
        if bp_s is not None and bp_d is not None and bp_d >= bp_s:
            raise serializers.ValidationError(
                {"bp_diastolic": "Diastolic pressure must be less than systolic."}
            )
        return attrs
