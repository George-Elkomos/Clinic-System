from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated

from .models import AllergyAlert, DosageForm, DosagePattern, Medication, MedicationClass
from .serializers import (
    AllergyAlertSerializer,
    DosageFormSerializer,
    DosagePatternSerializer,
    MedicationClassSerializer,
    MedicationSerializer,
)


class MedicationViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = MedicationSerializer
    permission_classes = [IsAuthenticated]
    queryset = Medication.objects.select_related("drug_class").prefetch_related("dosage_forms")
    filterset_fields = ["drug_class", "is_active"]
    search_fields = ["name", "name_ar"]


class MedicationClassViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = MedicationClassSerializer
    permission_classes = [IsAuthenticated]
    queryset = MedicationClass.objects.all()
    filterset_fields = ["is_active"]
    search_fields = ["name", "name_ar"]


class DosageFormViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = DosageFormSerializer
    permission_classes = [IsAuthenticated]
    queryset = DosageForm.objects.all()
    filterset_fields = ["is_active"]
    search_fields = ["name", "name_ar"]


class DosagePatternViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = DosagePatternSerializer
    permission_classes = [IsAuthenticated]
    queryset = DosagePattern.objects.all()
    filterset_fields = ["is_active"]
    search_fields = ["name", "name_ar", "code"]


class AllergyAlertViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = AllergyAlertSerializer
    permission_classes = [IsAuthenticated]
    queryset = AllergyAlert.objects.select_related("drug_class")
    filterset_fields = ["drug_class", "severity"]
    search_fields = ["allergy_keyword"]
