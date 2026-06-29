from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    ComplaintViewSet,
    DiagnosisCategoryViewSet,
    DiagnosisViewSet,
    EncounterViewSet,
)

router = DefaultRouter()
router.register("encounters", EncounterViewSet, basename="encounter")
router.register("complaints", ComplaintViewSet, basename="complaint")
router.register("diagnoses", DiagnosisViewSet, basename="diagnosis")
router.register("diagnosis-categories", DiagnosisCategoryViewSet, basename="diagnosis-category")

urlpatterns = [
    path("", include(router.urls)),
]
