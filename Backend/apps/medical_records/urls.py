from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    ClinicalNoteViewSet,
    LabOrderViewSet,
    LabResultViewSet,
    MedicalRecordViewSet,
    MyPatientsView,
    PatientTimelineView,
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
    path("patients/<int:pk>/timeline/", PatientTimelineView.as_view(), name="patient-timeline"),
    path("", include(router.urls)),
]
