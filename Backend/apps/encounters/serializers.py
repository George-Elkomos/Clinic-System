from rest_framework import serializers

from apps.core.enums import AppointmentType
from apps.medical_records.serializers import LabOrderListSerializer, PrescriptionSerializer
from apps.procedures.serializers import ClinicalProcedureListSerializer
from apps.radiology.serializers import RadiologyOrderListSerializer
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


class PreviousEncounterSummarySerializer(serializers.ModelSerializer):
    """Read-only snapshot of a prior visit, surfaced on a Follow-up encounter
    so the doctor has the last diagnosis/prescriptions/notes without leaving
    the page (see EncounterReadSerializer.get_previous_encounter)."""

    doctor_name = serializers.CharField(source="doctor.user.get_full_name", read_only=True, default="")
    diagnosis_detail = DiagnosisSerializer(source="diagnosis", read_only=True)
    prescriptions = PrescriptionSerializer(many=True, read_only=True)

    class Meta:
        model = Encounter
        fields = [
            "id", "encounter_date", "doctor_name", "chief_complaint",
            "diagnosis_detail", "diagnosis_notes", "treatment_plan", "prescriptions",
        ]
        read_only_fields = fields


class EncounterReadSerializer(serializers.ModelSerializer):
    patient_name = serializers.CharField(source="patient.user.get_full_name", read_only=True, default="")
    doctor_name = serializers.CharField(source="doctor.user.get_full_name", read_only=True, default="")
    diagnosis_detail = DiagnosisSerializer(source="diagnosis", read_only=True)
    vitals_detail = VitalSignsReadSerializer(source="vitals", read_only=True)
    prescriptions = PrescriptionSerializer(many=True, read_only=True)
    lab_orders = LabOrderListSerializer(many=True, read_only=True)
    procedures = ClinicalProcedureListSerializer(many=True, read_only=True)
    radiology_orders = RadiologyOrderListSerializer(many=True, read_only=True)
    # Patient snapshot + appointment context, so the doctor never has to leave
    # the encounter page to see why the visit was booked or check allergies.
    appointment_type = serializers.CharField(source="appointment.appointment_type", read_only=True, default="")
    appointment_type_display = serializers.CharField(source="appointment.get_appointment_type_display", read_only=True, default="")
    appointment_reason = serializers.CharField(source="appointment.reason", read_only=True, default="")
    patient_allergies = serializers.CharField(source="patient.allergies_summary", read_only=True, default="")
    patient_chronic_conditions = serializers.CharField(source="patient.chronic_conditions", read_only=True, default="")
    patient_current_medications = serializers.CharField(source="patient.current_medications", read_only=True, default="")
    previous_encounter = serializers.SerializerMethodField()

    def get_previous_encounter(self, obj):
        appointment = obj.appointment
        if appointment is None or appointment.appointment_type != AppointmentType.FOLLOW_UP:
            return None
        origin_followup = getattr(appointment, "origin_followup", None)
        if origin_followup is None:
            return None
        previous = getattr(origin_followup.origin_appointment, "encounter", None)
        if previous is None:
            return None
        return PreviousEncounterSummarySerializer(previous).data

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
            "prescriptions", "lab_orders", "procedures", "radiology_orders", "created_at",
            "appointment_type", "appointment_type_display", "appointment_reason",
            "patient_allergies", "patient_chronic_conditions", "patient_current_medications",
            "previous_encounter",
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
