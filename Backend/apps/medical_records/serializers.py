from pathlib import Path

from django.conf import settings
from rest_framework import serializers

from apps.core.enums import RoleChoices
from apps.users.models import PatientProfile

from .models import (
    ClinicalNote,
    LabResult,
    MedicalRecord,
    Prescription,
    PrescriptionItem,
    Scan,
)

ALLOWED_UPLOAD_EXTENSIONS = {".jpg", ".jpeg", ".png", ".pdf", ".dcm", ".dicom"}


def _validate_upload(file):
    if file is None:
        return
    ext = Path(file.name).suffix.lower()
    if ext not in ALLOWED_UPLOAD_EXTENSIONS:
        raise serializers.ValidationError(
            f"Unsupported file type '{ext}'. Allowed: JPG, PNG, PDF, DICOM."
        )
    if file.size > settings.MAX_UPLOAD_SIZE:
        mb = settings.MAX_UPLOAD_SIZE // (1024 * 1024)
        raise serializers.ValidationError(f"File is too large (max {mb} MB).")


class MedicalRecordSerializer(serializers.ModelSerializer):
    doctor_name = serializers.CharField(source="doctor.user.get_full_name", read_only=True, default="")

    class Meta:
        model = MedicalRecord
        fields = [
            "id", "patient", "doctor", "doctor_name", "version", "is_current",
            "supersedes", "chief_complaint", "diagnosis", "treatment_plan",
            "vitals", "appointment", "created_at",
        ]
        # Versioning + authorship are controlled by the service/view, not the client.
        read_only_fields = ["id", "doctor", "doctor_name", "version", "is_current",
                            "supersedes", "created_at"]


class ClinicalNoteSerializer(serializers.ModelSerializer):
    doctor_name = serializers.CharField(source="doctor.user.get_full_name", read_only=True, default="")
    specialty_category_name = serializers.CharField(source="specialty_category.name", read_only=True)

    class Meta:
        model = ClinicalNote
        fields = [
            "id", "patient", "doctor", "doctor_name", "specialty_category",
            "specialty_category_name", "medical_record", "body", "body_ar",
            "appointment", "created_at",
        ]
        read_only_fields = ["id", "doctor", "doctor_name", "created_at"]

    def validate(self, attrs):
        user = self.context["request"].user
        category = attrs.get("specialty_category") or getattr(self.instance, "specialty_category", None)
        if user.role == RoleChoices.DOCTOR and category is not None:
            if category.id not in user.doctor_profile.category_ids():
                raise serializers.ValidationError({
                    "specialty_category": "You can only add notes in your own specialty.",
                })
        return attrs


class ScanSerializer(serializers.ModelSerializer):
    # Optional on input: patients omit it (resolved to self); doctors send it.
    patient = serializers.PrimaryKeyRelatedField(queryset=PatientProfile.objects.all(), required=False)
    uploaded_by_name = serializers.CharField(source="uploaded_by.get_full_name", read_only=True, default="")

    class Meta:
        model = Scan
        fields = [
            "id", "patient", "uploaded_by", "uploaded_by_name", "category", "file",
            "original_filename", "content_type", "file_size", "description",
            "appointment", "taken_at", "created_at",
        ]
        read_only_fields = ["id", "uploaded_by", "uploaded_by_name",
                            "original_filename", "content_type", "file_size", "created_at"]

    def validate_file(self, value):
        _validate_upload(value)
        return value


class LabResultSerializer(serializers.ModelSerializer):
    patient = serializers.PrimaryKeyRelatedField(queryset=PatientProfile.objects.all(), required=False)
    uploaded_by_name = serializers.CharField(source="uploaded_by.get_full_name", read_only=True, default="")

    class Meta:
        model = LabResult
        fields = [
            "id", "patient", "uploaded_by", "uploaded_by_name", "test_name",
            "test_name_ar", "category", "result_value", "reference_range", "unit",
            "file", "result_date", "is_abnormal", "appointment", "created_at",
        ]
        read_only_fields = ["id", "uploaded_by", "uploaded_by_name", "created_at"]

    def validate_file(self, value):
        _validate_upload(value)
        return value


class PrescriptionItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = PrescriptionItem
        fields = ["id", "drug_name", "dosage", "frequency", "duration",
                  "instructions", "instructions_ar", "quantity"]
        read_only_fields = ["id"]


class PrescriptionSerializer(serializers.ModelSerializer):
    items = PrescriptionItemSerializer(many=True)
    doctor_name = serializers.CharField(source="doctor.user.get_full_name", read_only=True, default="")
    patient_name = serializers.CharField(source="patient.user.get_full_name", read_only=True, default="")

    class Meta:
        model = Prescription
        fields = [
            "id", "patient", "patient_name", "doctor", "doctor_name", "appointment",
            "issued_date", "notes", "notes_ar", "status", "items", "created_at",
        ]
        read_only_fields = ["id", "doctor", "doctor_name", "patient_name",
                            "issued_date", "created_at"]

    def create(self, validated_data):
        items = validated_data.pop("items", [])
        prescription = Prescription.objects.create(**validated_data)
        for item in items:
            PrescriptionItem.objects.create(prescription=prescription, **item)
        return prescription

    def update(self, instance, validated_data):
        items = validated_data.pop("items", None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if items is not None:  # replace the full item set
            instance.items.all().delete()
            for item in items:
                PrescriptionItem.objects.create(prescription=instance, **item)
        return instance


class PatientSummarySerializer(serializers.Serializer):
    """Lightweight patient row for the doctor's patient picker."""

    id = serializers.IntegerField()
    full_name = serializers.CharField(source="user.get_full_name")
    email = serializers.SerializerMethodField()
    phone = serializers.CharField(source="user.phone")
    date_of_birth = serializers.DateField()
    blood_type = serializers.CharField()

    def get_email(self, obj):
        email = obj.user.email
        if email.endswith("@noemail.clinic"):
            return None
        return email
