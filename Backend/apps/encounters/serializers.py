from rest_framework import serializers

from apps.medical_records.serializers import LabOrderListSerializer, PrescriptionSerializer
from apps.vital_signs.serializers import VitalSignsReadSerializer

from .models import Complaint, Diagnosis, DiagnosisCategory, Encounter


class ComplaintSerializer(serializers.ModelSerializer):
    class Meta:
        model = Complaint
        fields = ["id", "name", "name_ar", "category", "is_active"]


class DiagnosisCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = DiagnosisCategory
        fields = ["id", "name", "name_ar", "is_active"]


class DiagnosisSerializer(serializers.ModelSerializer):
    category_ref_name = serializers.CharField(source="category_ref.name", read_only=True, default="")

    class Meta:
        model = Diagnosis
        fields = [
            "id", "name", "name_ar", "category", "icd10_code", "is_chronic",
            "category_ref", "category_ref_name", "is_active",
        ]


class EncounterReadSerializer(serializers.ModelSerializer):
    patient_name = serializers.CharField(source="patient.user.get_full_name", read_only=True, default="")
    doctor_name = serializers.CharField(source="doctor.user.get_full_name", read_only=True, default="")
    diagnosis_detail = DiagnosisSerializer(source="diagnosis", read_only=True)
    vitals_detail = VitalSignsReadSerializer(source="vitals", read_only=True)
    prescriptions = PrescriptionSerializer(many=True, read_only=True)
    lab_orders = LabOrderListSerializer(many=True, read_only=True)

    class Meta:
        model = Encounter
        fields = [
            "id", "patient", "patient_name", "doctor", "doctor_name",
            "appointment", "encounter_date", "status",
            "chief_complaint", "chief_complaint_ar", "symptoms",
            "examination_findings", "examination_findings_ar",
            "diagnosis", "diagnosis_detail", "diagnosis_notes",
            "treatment_plan", "treatment_plan_ar",
            "vitals", "vitals_detail",
            "version", "is_current", "supersedes",
            "prescriptions", "lab_orders", "created_at",
        ]
        read_only_fields = fields


class EncounterWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Encounter
        fields = [
            "id", "patient", "appointment",
            "chief_complaint", "chief_complaint_ar", "symptoms",
            "examination_findings", "examination_findings_ar",
            "diagnosis", "diagnosis_notes",
            "treatment_plan", "treatment_plan_ar", "vitals",
        ]
        # patient/appointment are set on create only; never reassigned on PATCH.
        read_only_fields = ["id"]

    def validate_symptoms(self, value):
        if not isinstance(value, list) or any(not isinstance(v, str) for v in value):
            raise serializers.ValidationError("Symptoms must be a list of strings.")
        return value
