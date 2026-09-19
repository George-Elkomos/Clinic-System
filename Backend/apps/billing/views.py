import re

import django_filters
from django.db import transaction
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.services import record_event
from apps.core.enums import AuditAction, CashierShiftStatus, RoleChoices
from apps.users.permissions import IsManager, IsSecretaryOrManager

from . import services
from .models import CashierShift, CashMovement, Invoice, Payment, ServiceItem
from .permissions import ServiceItemPermission
from .serializers import (
    CashierShiftSerializer,
    CashMovementCreateSerializer,
    CashMovementSerializer,
    CloseShiftSerializer,
    InvoiceSerializer,
    OpenShiftSerializer,
    PaymentCreateSerializer,
    PaymentSerializer,
    ServiceItemSerializer,
)

VALID_PERIODS = {"day", "month", "year"}

# Opaque client token, not required to be a UUID — bounded to the
# IdempotentRequest.key column width and a conservative safe-character set
# (covers UUIDs and any reasonable client-generated token).
_IDEMPOTENCY_KEY_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,255}$")


def _require_idempotency_key(request):
    """Every financial write endpoint that can create a distinct domain
    record on retry (credit notes, refunds, cash movements, payments)
    requires this header — see apps/billing/idempotency.py. Raises DRF's own
    ValidationError (400, this project's existing convention for bad input)
    rather than a domain exception: a missing/malformed header is a client
    input problem, not a business-rule violation.
    """
    key = request.headers.get("Idempotency-Key", "")
    if not key:
        raise ValidationError({
            "idempotency_key": "The Idempotency-Key header is required for this operation.",
        })
    if not _IDEMPOTENCY_KEY_RE.match(key):
        raise ValidationError({
            "idempotency_key": "Idempotency-Key must be 1-255 characters (letters, digits, "
                               "'-', '_', '.', ':').",
        })
    return key


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
        idempotency_key = _require_idempotency_key(request)
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        payment = services.record_payment(
            invoice=data["invoice"],
            amount=data["amount"],
            payment_method=data["payment_method"],
            received_by=request.user,
            reference=data.get("reference", ""),
            idempotency_key=idempotency_key,
        )
        # Return the payment plus the refreshed invoice so the desk UI can
        # update the row (new balance/status) without a second request.
        payload = PaymentSerializer(payment).data
        payload["invoice_detail"] = InvoiceSerializer(payment.invoice).data
        return Response(payload, status=status.HTTP_201_CREATED)


class CashierShiftViewSet(
    mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet,
):
    """Financial roadmap Task 11 API surface.

    No generic create/update/delete: a shift is only ever opened/closed
    through the two explicit domain actions below (never a bare POST/PATCH to
    the collection), and a CLOSED shift is immutable at the model layer
    anyway (`CashierShift.save()` raises) — a closed shift must never look
    editable through a ModelViewSet.

    Secretaries see only their own shifts (`get_object()` 404s on someone
    else's, same "missing rows 404, never leak" convention as InvoiceViewSet);
    managers see every shift, which is also what lets a manager close a
    cashier's shift in person.
    """

    serializer_class = CashierShiftSerializer
    permission_classes = [IsSecretaryOrManager]
    filterset_fields = ["cashier", "till_id", "status"]

    def get_queryset(self):
        user = self.request.user
        qs = CashierShift.objects.select_related("cashier", "closed_by", "approved_by")
        if user.role == RoleChoices.MANAGER:
            return qs
        return qs.filter(cashier=user)

    @action(detail=False, methods=["get"])
    def current(self, request):
        """GET /api/cashier-shifts/current/ — the caller's own open shift, or null."""
        shift = services.current_shift(request.user)
        if shift is None:
            return Response(None, status=status.HTTP_200_OK)
        return Response(self.get_serializer(shift).data)

    @action(detail=False, methods=["post"])
    def open(self, request):
        """POST /api/cashier-shifts/open/ — always opens a shift *for the
        caller*; `cashier` is never taken from the request body (nothing to
        authorize otherwise — you cannot open a till session as someone
        else). Duplicate-shift races are caught by services.open_shift's own
        UniqueConstraint + IntegrityError handling."""
        serializer = OpenShiftSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        kwargs = {"cashier": request.user}
        if "till_id" in data:
            kwargs["till_id"] = data["till_id"]
        if "opening_float" in data:
            kwargs["opening_float"] = data["opening_float"]
        shift = services.open_shift(**kwargs)
        return Response(
            self.get_serializer(shift).data, status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"], url_path="close")
    def close(self, request, pk=None):
        """POST /api/cashier-shifts/{id}/close/ — counts the drawer and posts
        the variance via services.close_shift.

        A variance is a financial correction (financial roadmap Task 15): only
        a MANAGER may close a shift that comes out uneven — a secretary
        closing their own shift may only do so when the count matches exactly.
        `approved_by` is always `request.user`, never client-supplied, and is
        only set at all when a manager is actually the one closing with a
        variance (never for an exact count, matching services.close_shift's
        own "no variance -> no approver" contract).

        The shift row is locked once, up front, inside one transaction — the
        permission decision (is there a variance? does the actor outrank it?)
        and the actual close happen against the same locked snapshot, so nothing
        can change between deciding "no manager needed" and committing the close.
        """
        shift = self.get_object()  # queryset scoping already 404s a cross-cashier attempt
        serializer = CloseShiftSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        with transaction.atomic():
            locked = CashierShift.objects.select_for_update().get(pk=shift.pk)
            if locked.status != CashierShiftStatus.OPEN:
                raise ValidationError({"shift": "This shift is already closed."})

            is_manager = request.user.role == RoleChoices.MANAGER
            if not (is_manager or locked.cashier_id == request.user.id):
                raise PermissionDenied("You may only close your own cashier shift.")

            variance = data["counted_amount"] - services.expected_cash(locked)
            if variance and not is_manager:
                raise PermissionDenied(
                    "Closing this shift shows a variance — a manager must close it."
                )

            closed = services.close_shift(
                shift=locked,
                counted_amount=data["counted_amount"],
                closed_by=request.user,
                reason_code=data.get("reason_code", ""),
                approved_by=request.user if (variance and is_manager) else None,
                notes=data.get("notes", ""),
            )
        return Response(self.get_serializer(closed).data, status=status.HTTP_200_OK)


class CashMovementViewSet(
    mixins.CreateModelMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """Financial roadmap Task 17 API surface.

    No update/delete: a posted cash movement is corrected with a new,
    offsetting movement (the model itself refuses a delete; there is simply
    no update path exposed here at all — matching the "avoid update/delete of
    posted financial movements" rule for this task).
    """

    permission_classes = [IsSecretaryOrManager]
    filterset_fields = ["shift", "movement_type"]

    def get_queryset(self):
        user = self.request.user
        qs = CashMovement.objects.select_related("shift", "created_by")
        if user.role == RoleChoices.MANAGER:
            return qs
        return qs.filter(shift__cashier=user)

    def get_serializer_class(self):
        return CashMovementCreateSerializer if self.request.method == "POST" else CashMovementSerializer

    def create(self, request, *args, **kwargs):
        idempotency_key = _require_idempotency_key(request)
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        shift = data["shift"]

        is_manager = request.user.role == RoleChoices.MANAGER
        if not (is_manager or shift.cashier_id == request.user.id):
            raise PermissionDenied("You may only log a movement on your own cashier shift.")

        movement = services.record_cash_movement(
            shift=shift,
            movement_type=data["movement_type"],
            amount=data["amount"],
            reason=data["reason"],
            created_by=request.user,
            idempotency_key=idempotency_key,
        )
        return Response(
            CashMovementSerializer(movement).data, status=status.HTTP_201_CREATED,
        )


class BillingReportView(APIView):
    """GET /api/reports/billing/?period=day|month|year — manager financials."""

    permission_classes = [IsManager]

    def get(self, request):
        period = request.query_params.get("period", "month")
        if period not in VALID_PERIODS:
            period = "month"
        return Response(services.billing_report(period))


class BillingSummaryView(BillingReportView):
    """GET /api/reports/billing-summary/?period=day|month|year — Phase 16
    alias of BillingReportView under the new analytics naming. Identical
    aggregation (services.billing_report); the only difference is the
    Phase 16 manager-view audit trail, added only here so the pre-existing
    /reports/billing/ endpoint (BillingReportsPage.tsx) stays unchanged."""

    def get(self, request):
        record_event(actor=request.user, action=AuditAction.ACCESS, request=request)
        return super().get(request)
