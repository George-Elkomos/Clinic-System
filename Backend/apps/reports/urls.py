from django.urls import path

from .views import DiagnosisDistributionView, ReportsDashboardView, ReportsExportView

urlpatterns = [
    path("reports/dashboard/", ReportsDashboardView.as_view(), name="reports-dashboard"),
    path("reports/export/", ReportsExportView.as_view(), name="reports-export"),
    path("reports/diagnosis-distribution/", DiagnosisDistributionView.as_view(), name="reports-diagnosis-distribution"),
]
