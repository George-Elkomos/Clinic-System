from django.conf import settings
from django.http import FileResponse, HttpResponse
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.services import record_event
from apps.core.enums import AuditAction
from apps.users.permissions import IsManager

from .analytics_services import lab_analytics, specialty_analytics
from .exporters import render_report_csv, render_report_pdf
from .services import build_report, diagnosis_distribution

VALID_PERIODS = {"week", "month", "all"}


def _period(request):
    period = request.query_params.get("period", "month")
    return period if period in VALID_PERIODS else "month"


class ReportsDashboardView(APIView):
    permission_classes = [IsManager]

    def get(self, request):
        return Response(build_report(_period(request)))


DIAGNOSIS_VALID_PERIODS = {"week", "month", "all", "year"}
DIAGNOSIS_DEFAULT_LIMIT = 20
DIAGNOSIS_MAX_LIMIT = 50


class DiagnosisDistributionView(APIView):
    permission_classes = [IsManager]

    def get(self, request):
        period = request.query_params.get("period", "month")
        if period not in DIAGNOSIS_VALID_PERIODS:
            period = "month"
        try:
            limit = int(request.query_params.get("limit", DIAGNOSIS_DEFAULT_LIMIT))
        except (TypeError, ValueError):
            limit = DIAGNOSIS_DEFAULT_LIMIT
        limit = max(1, min(limit, DIAGNOSIS_MAX_LIMIT))

        record_event(actor=request.user, action=AuditAction.ACCESS, request=request)
        return Response(diagnosis_distribution(period, limit=limit))


class ReportsExportView(APIView):
    permission_classes = [IsManager]

    def get(self, request):
        period = _period(request)
        # NB: param is "fmt", not "format" — DRF reserves ?format= for renderer negotiation.
        fmt = request.query_params.get("fmt", "pdf")
        report = build_report(period)
        # Phase 16: bundle the newer analytics sections into the same export so
        # the PDF/CSV don't lag behind what the dashboard page shows. These use
        # the same raw `period` value the dashboard passes to their endpoints —
        # week/month/year map straight through; any other value (e.g. "all")
        # falls back to month-start inside apps.core.periods.period_start.
        specialty = specialty_analytics(period)
        lab = lab_analytics(period)
        diagnoses = diagnosis_distribution(period, limit=20)

        if fmt == "csv":
            response = HttpResponse(
                render_report_csv(report, specialty, lab, diagnoses), content_type="text/csv"
            )
            response["Content-Disposition"] = f'attachment; filename="clinic_report_{period}.csv"'
            return response

        pdf = render_report_pdf(
            report, specialty, lab, diagnoses, clinic_name=getattr(settings, "CLINIC_NAME", "Clinic")
        )
        response = FileResponse(iter([pdf]), content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="clinic_report_{period}.pdf"'
        return response
