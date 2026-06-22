"""Root URL configuration.

Every API lives under /api/. Each app owns a router/urlconf included here.
"""
from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path

api_patterns = [
    path("auth/", include("apps.users.urls")),
    path("", include("apps.users.staff_urls")),  # staff creation + user management
    path("", include("apps.doctors.urls")),
    path("", include("apps.appointments.urls")),
    path("", include("apps.notifications.urls")),
    path("", include("apps.audit.urls")),  # manager-only audit search (cross-cutting)
    path("", include("apps.medical_records.urls")),  # Phase 2
    path("", include("apps.reviews.urls")),  # Phase 4
    path("", include("apps.reports.urls")),  # Phase 4
    path("", include("apps.vital_signs.urls")),  # Phase 5
    path("", include("apps.ai_scribe.urls")),  # AI medical scribe
]

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include(api_patterns)),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
