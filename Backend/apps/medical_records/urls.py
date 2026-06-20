from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    ClinicalNoteViewSet,
    LabOrderViewSet,
    LabResultViewSet,
    MedicalRecordViewSet,
    MyPatientsView,
    PrescriptionViewSet,
    ScanViewSet,
)

router = DefaultRouter()
router.register("medical-records", MedicalRecordViewSet, basename="medical-record")
router.register("clinical-notes", ClinicalNoteViewSet, basename="clinical-note")
router.register("scans", ScanViewSet, basename="scan")
router.register("lab-results", LabResultViewSet, basename="lab-result")
router.register("prescriptions", PrescriptionViewSet, basename="prescription")
router.register("lab-orders", LabOrderViewSet, basename="lab-order")

urlpatterns = [
    path("medical/patients/", MyPatientsView.as_view(), name="my-patients"),
    path("", include(router.urls)),
]
