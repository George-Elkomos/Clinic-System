from rest_framework import serializers

from apps.core.enums import ProcedureStatus

from .models import ClinicalProcedure, ProcedureTemplate

TERMINAL_STATUSES = (ProcedureStatus.COMPLETED, ProcedureStatus.CANCELLED)


class ProcedureTemplateSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProcedureTemplate
        fields = [
            "id", "name", "name_ar", "category", "description",
            "estimated_duration_minutes", "checklist_template", "is_active",
        ]


def _validate_checklist(value):
    if not isinstance(value, list):
        raise serializers.ValidationError("Checklist must be a list of steps.")
    for i, item in enumerate(value):
        if not isinstance(item, dict) or "step" not in item:
            raise serializers.ValidationError(f"Checklist item #{i + 1} must be an object with a 'step' key.")
        if not isinstance(item.get("step"), str) or not item["step"].strip():
            raise serializers.ValidationError(f"Checklist item #{i + 1} is missing a non-empty 'step'.")
    return value


class ClinicalProcedureSerializer(serializers.ModelSerializer):
    patient_name = serializers.CharField(source="patient.user.get_full_name", read_only=True, default="")
    doctor_name = serializers.CharField(source="doctor.user.get_full_name", read_only=True, default="")
    template_detail = ProcedureTemplateSerializer(source="template", read_only=True)

    class Meta:
        model = ClinicalProcedure
        fields = [
            "id", "patient", "patient_name", "doctor", "doctor_name",
            "appointment", "encounter", "template", "template_detail",
            "procedure_name", "procedure_name_ar", "status",
            "checklist_state", "pre_procedure_notes", "post_procedure_notes",
            "complications", "start_time", "end_time",
            "cancellation_reason", "cancelled_at", "created_at",
        ]
        read_only_fields = [
            "id", "doctor", "doctor_name", "patient_name", "template_detail",
            "status", "start_time", "end_time", "cancellation_reason",
            "cancelled_at", "created_at",
        ]

    def validate_checklist_state(self, value):
        return _validate_checklist(value)

    def validate(self, attrs):
        if self.instance and self.instance.status in TERMINAL_STATUSES:
            locked_fields = {"checklist_state", "pre_procedure_notes", "post_procedure_notes", "complications"}
            if locked_fields & set(attrs):
                raise serializers.ValidationError(
                    f"Cannot edit a procedure with status '{self.instance.status}'."
                )
        if not self.instance:
            has_template = attrs.get("template") is not None
            has_name = bool(attrs.get("procedure_name", "").strip())
            if not has_template and not has_name:
                raise serializers.ValidationError(
                    "Either a template or a custom procedure_name is required."
                )
        return attrs


class ClinicalProcedureListSerializer(serializers.ModelSerializer):
    """Lightweight list/embed view — no checklist or notes."""

    patient_name = serializers.CharField(source="patient.user.get_full_name", read_only=True, default="")
    doctor_name = serializers.CharField(source="doctor.user.get_full_name", read_only=True, default="")

    class Meta:
        model = ClinicalProcedure
        fields = [
            "id", "patient", "patient_name", "doctor", "doctor_name",
            "appointment", "encounter", "template",
            "procedure_name", "procedure_name_ar", "status",
            "start_time", "end_time", "created_at",
        ]


class ProcedureCompleteSerializer(serializers.Serializer):
    post_procedure_notes = serializers.CharField(required=False, allow_blank=True)
    complications = serializers.CharField(required=False, allow_blank=True)


class ProcedureCancelSerializer(serializers.Serializer):
    reason = serializers.CharField(min_length=3, max_length=500)
