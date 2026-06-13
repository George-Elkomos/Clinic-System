from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    AvailableSlotsView,
    DoctorAbsenceViewSet,
    DoctorProfileViewSet,
    PublicDoctorViewSet,
    SpecialtyCategoryViewSet,
    SpecialtyViewSet,
    WorkingScheduleViewSet,
)

router = DefaultRouter()
router.register("doctors", DoctorProfileViewSet, basename="doctor")
router.register("specialty-categories", SpecialtyCategoryViewSet, basename="specialty-category")
router.register("specialties", SpecialtyViewSet, basename="specialty")
router.register("working-schedules", WorkingScheduleViewSet, basename="working-schedule")
router.register("doctor-absences", DoctorAbsenceViewSet, basename="doctor-absence")
router.register("public/doctors", PublicDoctorViewSet, basename="public-doctor")

urlpatterns = [
    path("slots/available/", AvailableSlotsView.as_view(), name="available-slots"),
    path("", include(router.urls)),
]
