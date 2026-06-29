from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    AllergyAlertViewSet,
    DosageFormViewSet,
    DosagePatternViewSet,
    MedicationClassViewSet,
    MedicationViewSet,
)

router = DefaultRouter()
router.register("medications", MedicationViewSet, basename="medication")
router.register("medication-classes", MedicationClassViewSet, basename="medication-class")
router.register("dosage-forms", DosageFormViewSet, basename="dosage-form")
router.register("dosage-patterns", DosagePatternViewSet, basename="dosage-pattern")
router.register("allergy-alerts", AllergyAlertViewSet, basename="allergy-alert")

urlpatterns = [
    path("", include(router.urls)),
]
