from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import RadiologyOrderViewSet, RadiologyTemplateViewSet

router = DefaultRouter()
router.register("radiology-templates", RadiologyTemplateViewSet, basename="radiology-template")
router.register("radiology-orders", RadiologyOrderViewSet, basename="radiology-order")

urlpatterns = [
    path("", include(router.urls)),
]
