from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import ClinicalProcedureViewSet, ProcedureTemplateViewSet

router = DefaultRouter()
router.register("procedure-templates", ProcedureTemplateViewSet, basename="procedure-template")
router.register("procedures", ClinicalProcedureViewSet, basename="procedure")

urlpatterns = [
    path("", include(router.urls)),
]
