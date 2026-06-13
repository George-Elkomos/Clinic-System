from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    AppointmentViewSet,
    FollowUpViewSet,
    KioskQueueView,
    PatientDirectoryView,
    WaitlistEntryViewSet,
)

router = DefaultRouter()
router.register("appointments", AppointmentViewSet, basename="appointment")
router.register("waitlist", WaitlistEntryViewSet, basename="waitlist")
router.register("followups", FollowUpViewSet, basename="followup")

urlpatterns = [
    path("public/kiosk/<int:doctor_id>/", KioskQueueView.as_view(), name="kiosk-queue"),
    path("patients/", PatientDirectoryView.as_view(), name="patient-directory"),
    path("", include(router.urls)),
]
