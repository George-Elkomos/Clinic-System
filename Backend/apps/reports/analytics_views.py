"""Phase 16 — advanced analytics views. Kept out of views.py to avoid
cluttering the Phase 4 report views."""
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.services import record_event
from apps.core.enums import AuditAction, PeriodChoices
from apps.users.permissions import IsManager

from .analytics_services import lab_analytics, specialty_analytics

VALID_PERIODS = {c.value for c in PeriodChoices}  # {"week", "month", "year"}


def _period(request):
    period = request.query_params.get("period", PeriodChoices.MONTH)
    return period if period in VALID_PERIODS else PeriodChoices.MONTH


class SpecialtyAnalyticsView(APIView):
    """GET /api/reports/specialty-analytics/?period=week|month|year"""

    permission_classes = [IsManager]

    def get(self, request):
        record_event(actor=request.user, action=AuditAction.ACCESS, request=request)
        return Response(specialty_analytics(_period(request)))


class LabAnalyticsView(APIView):
    """GET /api/reports/lab-analytics/?period=week|month|year"""

    permission_classes = [IsManager]

    def get(self, request):
        record_event(actor=request.user, action=AuditAction.ACCESS, request=request)
        return Response(lab_analytics(_period(request)))
