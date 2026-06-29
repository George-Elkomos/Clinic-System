from rest_framework import serializers

from .models import AllergyAlert, DosageForm, DosagePattern, Medication, MedicationClass


class MedicationClassSerializer(serializers.ModelSerializer):
    class Meta:
        model = MedicationClass
        fields = ["id", "name", "name_ar", "is_active"]


class DosageFormSerializer(serializers.ModelSerializer):
    class Meta:
        model = DosageForm
        fields = ["id", "name", "name_ar", "is_active"]


class DosagePatternSerializer(serializers.ModelSerializer):
    class Meta:
        model = DosagePattern
        fields = ["id", "name", "name_ar", "code", "is_active"]


class MedicationSerializer(serializers.ModelSerializer):
    drug_class_name = serializers.CharField(source="drug_class.name", read_only=True, default="")

    class Meta:
        model = Medication
        fields = [
            "id", "name", "name_ar", "brand_names",
            "drug_class", "drug_class_name", "dosage_forms",
            "requires_prescription", "is_active",
        ]


class AllergyAlertSerializer(serializers.ModelSerializer):
    drug_class_name = serializers.CharField(source="drug_class.name", read_only=True, default="")

    class Meta:
        model = AllergyAlert
        fields = [
            "id", "allergy_keyword", "drug_class", "drug_class_name",
            "severity", "message", "message_ar",
        ]
