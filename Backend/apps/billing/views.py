import django_filters
from rest_framework import mixins, status, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.enums import RoleChoices
from apps.users.permissions import IsManager, IsSecretaryOrManager

from . import services
from .models import Invoice, Payment, ServiceItem
from .permissions import ServiceItemPermission
from .serializers import (
    InvoiceSerializer,
    PaymentCreateSerializer,
    PaymentSerializer,
    ServiceItemSerializer,
)

VALID_PERIODS = {"day", "month", "year"}


class _CharInFilter(django_filters.BaseInFilter, django_filters.CharFilter):
    """Comma-separated exact-match list, e.g. ?status=ISSUED,PARTIALLY_PAID.

    Needed for the billing desk's "Outstanding" view (ISSUED + PARTIALLY_PAID)
    — a plain `filterset_fields` entry only supports a single exact value, which
    would force the desk to filter client-side after fetching one page and
    silently hide outstanding invoices once the clinic has more than one page.
    """


class InvoiceFilter(django_filters.FilterSet):
    status = _CharInFilter(field_name="status")

    class Meta:
        model = Invoice
        fields = ["status", "patient", "doctor"]


class ServiceItemViewSet(viewsets.ModelViewSet):
    """Pricing catalog. Staff browse; managers manage."""

    serializer_class = ServiceItemSerializer
    permission_classes = [ServiceItemPermission]
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]
    filterset_fields = ["item_type", "is_active"]
    search_fields = ["name", "name_ar"]

    def get_queryset(self):
        return ServiceItem.objects.all()


class InvoiceViewSet(viewsets.ReadOnlyModelViewSet):
    """GET /api/invoices/ — object-level scoping per role.

    Patients see only their own invoices (missing rows 404, never leak);
    doctors see invoices for their consultations; secretary/manager see all.
    """

    serializer_class = InvoiceSerializer
    filterset_class = InvoiceFilter

    def get_queryset(self):
        user = self.request.user
        qs = Invoice.objects.select_related("patient", "doctor").prefetch_related(
            "items", "payments__received_by"
        )
        if user.role in (RoleChoices.SECRETARY, RoleChoices.MANAGER):
            return qs
        if user.role == RoleChoices.PATIENT:
            return qs.filter(patient=user)
        if user.role == RoleChoices.DOCTOR:
            return qs.filter(doctor=user)
        return qs.none()


class PaymentViewSet(
    mixins.CreateModelMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """POST /api/payments/ — record money against an invoice (front desk only).

    The service layer updates paid_amount, re-derives balance, and flips the
    invoice status to PARTIALLY_PAID or PAID.
    """

    permission_classes = [IsSecretaryOrManager]
    filterset_fields = ["invoice", "payment_method"]

    def get_queryset(self):
        return Payment.objects.select_related("invoice", "received_by")

    def get_serializer_class(self):
        return PaymentCreateSerializer if self.request.method == "POST" else PaymentSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        payment = services.record_payment(
            invoice=data["invoice"],
            amount=data["amount"],
            payment_method=data["payment_method"],
            received_by=request.user,
            reference=data.get("reference", ""),
        )
        # Return the payment plus the refreshed invoice so the desk UI can
        # update the row (new balance/status) without a second request.
        payload = PaymentSerializer(payment).data
        payload["invoice_detail"] = InvoiceSerializer(payment.invoice).data
        return Response(payload, status=status.HTTP_201_CREATED)


class BillingReportView(APIView):
    """GET /api/reports/billing/?period=day|month|year — manager financials."""

    permission_classes = [IsManager]

    def get(self, request):
        period = request.query_params.get("period", "month")
        if period not in VALID_PERIODS:
            period = "month"
        return Response(services.billing_report(period))
