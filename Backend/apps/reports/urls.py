from django.urls import path

from .analytics_views import LabAnalyticsView, SpecialtyAnalyticsView
from .views import DiagnosisDistributionView, ReportsDashboardView, ReportsExportView

urlpatterns = [
    path("reports/dashboard/", ReportsDashboardView.as_view(), name="reports-dashboard"),
    path("reports/export/", ReportsExportView.as_view(), name="reports-export"),
    path("reports/diagnosis-distribution/", DiagnosisDistributionView.as_view(), name="reports-diagnosis-distribution"),
    path("reports/specialty-analytics/", SpecialtyAnalyticsView.as_view(), name="reports-specialty-analytics"),
    path("reports/lab-analytics/", LabAnalyticsView.as_view(), name="reports-lab-analytics"),
]
