from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import VitalSignsViewSet

router = DefaultRouter()
router.register("vital-signs", VitalSignsViewSet, basename="vital-signs")

urlpatterns = [path("", include(router.urls))]
