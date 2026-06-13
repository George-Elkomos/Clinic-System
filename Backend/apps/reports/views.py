from django.conf import settings
from django.http import FileResponse, HttpResponse
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.users.permissions import IsManager

from .exporters import render_report_csv, render_report_pdf
from .services import build_report

VALID_PERIODS = {"week", "month", "all"}


def _period(request):
    period = request.query_params.get("period", "month")
    return period if period in VALID_PERIODS else "month"


class ReportsDashboardView(APIView):
    permission_classes = [IsManager]

    def get(self, request):
        return Response(build_report(_period(request)))


class ReportsExportView(APIView):
    permission_classes = [IsManager]

    def get(self, request):
        period = _period(request)
        # NB: param is "fmt", not "format" — DRF reserves ?format= for renderer negotiation.
        fmt = request.query_params.get("fmt", "pdf")
        report = build_report(period)

        if fmt == "csv":
            response = HttpResponse(render_report_csv(report), content_type="text/csv")
            response["Content-Disposition"] = f'attachment; filename="clinic_report_{period}.csv"'
            return response

        pdf = render_report_pdf(report, clinic_name=getattr(settings, "CLINIC_NAME", "Clinic"))
        response = FileResponse(iter([pdf]), content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="clinic_report_{period}.pdf"'
        return response
