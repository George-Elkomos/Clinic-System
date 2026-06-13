from django.urls import path

from .views import ReportsDashboardView, ReportsExportView

urlpatterns = [
    path("reports/dashboard/", ReportsDashboardView.as_view(), name="reports-dashboard"),
    path("reports/export/", ReportsExportView.as_view(), name="reports-export"),
]
