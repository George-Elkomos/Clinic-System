from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import SessionRecordingViewSet

router = DefaultRouter()
router.register("ai/sessions", SessionRecordingViewSet, basename="ai-session")

urlpatterns = [
    path("", include(router.urls)),
]
