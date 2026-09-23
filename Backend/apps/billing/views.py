import re

import django_filters
from django.db import transaction
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.services import record_event
from apps.core.enums import AuditAction, CashierShiftStatus, InvoiceStatus, RoleChoices
from apps.users.permissions import IsManager, IsSecretaryOrManager

from . import services
from .models import CashierShift, CashMovement, Invoice, InvoiceItem, Payment, ServiceItem, WriteOff
from .permissions import ServiceItemPermission
from .serializers import (
    CancelInvoiceSerializer,
    CashierShiftSerializer,
    CashMovementCreateSerializer,
    CashMovementSerializer,
    CloseShiftSerializer,
    CreditNoteCreateSerializer,
    CreditNoteSerializer,
    InvoiceItemSerializer,
    InvoiceSerializer,
    OpenShiftSerializer,
    PaymentCreateSerializer,
    PaymentSerializer,
    RefundCreateSerializer,
    RefundSerializer,
    ResolveItemPricingSerializer,
    ServiceItemSerializer,
    WriteOffCreateSerializer,
    WriteOffReversalCreateSerializer,
    WriteOffReversalSerializer,
    WriteOffSerializer,
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

    The correction actions below (financial roadmap Tasks 7/15) always take
    `approved_by`/`cancelled_by` from `request.user`, never the request body.
    `credit_note`/`refund`/`write_off` are open to SECRETARY *or* MANAGER at
    the view layer — the actual amount-vs-threshold decision is enforced
    inside the service function itself (`apps.billing.approvals.
    require_authorization`), not here, so it can't be bypassed by a direct
    service call outside DRF. `cancel` stays MANAGER-only at both layers —
    it has no threshold concept at all.

    DRAFT invoices are internal working objects (encounter-based DRAFT
    invoicing) — excluded here for every action except `issue`, which is the
    one action that must be able to find one. Secretary/Manager access to a
    DRAFT otherwise happens only through `EncounterPendingBillView`, never
    this general list/retrieve surface.
    """

    serializer_class = InvoiceSerializer
    filterset_class = InvoiceFilter

    def get_queryset(self):
        user = self.request.user
        qs = Invoice.objects.select_related("patient", "doctor").prefetch_related(
            "items", "payments__received_by"
        )
        if self.action != "issue":
            qs = qs.exclude(status=InvoiceStatus.DRAFT)
        if user.role in (RoleChoices.SECRETARY, RoleChoices.MANAGER):
            return qs
        if user.role == RoleChoices.PATIENT:
            return qs.filter(patient=user)
        if user.role == RoleChoices.DOCTOR:
            return qs.filter(doctor=user)
        return qs.none()

    def get_permissions(self):
        if self.action in ("credit_note", "refund", "write_off", "issue"):
            return [IsSecretaryOrManager()]
        if self.action == "cancel":
            return [IsManager()]
        return super().get_permissions()

    @action(detail=True, methods=["post"], url_path="issue")
    def issue(self, request, pk=None):
        """POST /api/invoices/{id}/issue/ — reception checkout. Reuses
        services.issue_invoice, which targets this exact pk — never "the
        current DRAFT for an encounter" — so a delayed/retried request can
        only ever act on the invoice it originally named, never a later
        supplementary one. Safe to call again after success: returns the
        same already-issued invoice, allocates no second number, posts
        nothing twice."""
        invoice = self.get_object()
        issued = services.issue_invoice(invoice.pk, user=request.user)
        return Response(
            InvoiceSerializer(issued, context={"request": request}).data,
            status=status.HTTP_200_OK,
        )

    @action(detail=True, methods=["post"], url_path="credit-note")
    def credit_note(self, request, pk=None):
        """POST /api/invoices/{id}/credit-note/ — reuses services.issue_credit_note;
        all validation (amount > 0, cannot exceed remaining balance,
        reason_code required, threshold/role authorization) lives there, not
        here — a SECRETARY above FINANCE_APPROVAL_THRESHOLD_CREDIT_NOTE gets a
        clean 403 from the service itself."""
        invoice = self.get_object()
        idempotency_key = _require_idempotency_key(request)
        serializer = CreditNoteCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        note = services.issue_credit_note(
            invoice=invoice,
            amount=serializer.validated_data["amount"],
            reason_code=serializer.validated_data["reason_code"],
            approved_by=request.user,
            idempotency_key=idempotency_key,
        )
        return Response(
            {
                **CreditNoteSerializer(note).data,
                "invoice": InvoiceSerializer(note.invoice, context={"request": request}).data,
            },
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"], url_path="refund")
    def refund(self, request, pk=None):
        """POST /api/invoices/{id}/refund/ — reuses services.issue_refund. The
        refund cap (paid_amount - already_refunded, never invoice.total) and
        the till attribution (paid_by, distinct from approved_by) are both
        enforced there."""
        invoice = self.get_object()
        idempotency_key = _require_idempotency_key(request)
        serializer = RefundCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        refund = services.issue_refund(
            invoice=invoice,
            amount=data["amount"],
            payment_method=data["payment_method"],
            reason_code=data["reason_code"],
            approved_by=request.user,
            paid_by=data.get("paid_by") or request.user,
            idempotency_key=idempotency_key,
        )
        return Response(
            {
                **RefundSerializer(refund).data,
                "invoice": InvoiceSerializer(refund.invoice, context={"request": request}).data,
            },
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"], url_path="cancel")
    def cancel(self, request, pk=None):
        """POST /api/invoices/{id}/cancel/ — reuses services.cancel_invoice,
        which refuses invoices with anything collected (refund first) and
        reverses the original posting rather than editing/deleting it."""
        invoice = self.get_object()
        serializer = CancelInvoiceSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        cancelled = services.cancel_invoice(
            invoice=invoice,
            reason_code=serializer.validated_data["reason_code"],
            cancelled_by=request.user,
        )
        return Response(
            InvoiceSerializer(cancelled, context={"request": request}).data,
            status=status.HTTP_200_OK,
        )

    @action(detail=True, methods=["post"], url_path="write-off")
    def write_off(self, request, pk=None):
        """POST /api/invoices/{id}/write-off/ — reuses services.write_off_invoice;
        all validation (amount > 0, cannot exceed remaining balance,
        eligible invoice status, reason_code required, threshold/role
        authorization) lives there, not here."""
        invoice = self.get_object()
        idempotency_key = _require_idempotency_key(request)
        serializer = WriteOffCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        write_off = services.write_off_invoice(
            invoice=invoice,
            amount=serializer.validated_data["amount"],
            reason_code=serializer.validated_data["reason_code"],
            approved_by=request.user,
            idempotency_key=idempotency_key,
        )
        return Response(
            {
                **WriteOffSerializer(write_off).data,
                "invoice": InvoiceSerializer(write_off.invoice, context={"request": request}).data,
            },
            status=status.HTTP_201_CREATED,
        )


class InvoiceItemViewSet(
    mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet,
):
    """Read access to invoice line items, plus the one lifecycle action a
    line has for a missing catalog price — resolving it (encounter-based
    DRAFT invoicing). Mirrors `WriteOffViewSet`'s shape: no generic create —
    an `InvoiceItem` is only ever created by the billing completion hooks or
    `services.issue_invoice`'s checkout flow, never directly."""

    serializer_class = InvoiceItemSerializer
    permission_classes = [IsSecretaryOrManager]
    filterset_fields = ["invoice", "needs_pricing"]

    def get_queryset(self):
        return InvoiceItem.objects.select_related("invoice", "service_item")

    @action(detail=True, methods=["post"], url_path="resolve-pricing")
    def resolve_pricing(self, request, pk=None):
        """POST /api/invoice-items/{id}/resolve-pricing/ — one-way fix for a
        DRAFT line captured with needs_pricing=True. Gated the same as every
        other billing mutation (IsSecretaryOrManager) — there is no more
        specific "billing correction" permission in this codebase to prefer
        over that established policy."""
        item = self.get_object()
        serializer = ResolveItemPricingSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        resolved = services.resolve_item_pricing(
            item, unit_price=serializer.validated_data["unit_price"], user=request.user,
        )
        return Response(
            InvoiceItemSerializer(resolved, context={"request": request}).data,
        )


class WriteOffViewSet(
    mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet,
):
    """Financial roadmap Task 15 API surface for write-offs.

    No generic create: a `WriteOff` is only ever created through
    `InvoiceViewSet.write_off` (it needs the invoice's own locked balance to
    validate against). This ViewSet is read access plus the one lifecycle
    action a write-off has after creation — reversing it.
    """

    serializer_class = WriteOffSerializer
    permission_classes = [IsSecretaryOrManager]
    filterset_fields = ["invoice"]

    def get_queryset(self):
        return WriteOff.objects.select_related("invoice", "approved_by", "reversal")

    @action(detail=True, methods=["post"], url_path="reverse")
    def reverse(self, request, pk=None):
        """POST /api/write-offs/{id}/reverse/ — MANAGER-only (enforced inside
        services.reverse_write_off itself, not only by this view's coarse
        RBAC); full reversal only, one per write-off."""
        write_off = self.get_object()
        idempotency_key = _require_idempotency_key(request)
        serializer = WriteOffReversalCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        reversal = services.reverse_write_off(
            write_off=write_off,
            reason_code=serializer.validated_data["reason_code"],
            reversed_by=request.user,
            idempotency_key=idempotency_key,
        )
        return Response(
            {
                **WriteOffReversalSerializer(reversal).data,
                "invoice": InvoiceSerializer(
                    reversal.write_off.invoice, context={"request": request},
                ).data,
            },
            status=status.HTTP_201_CREATED,
        )


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

        Whether the variance is small enough for a SECRETARY to close alone,
        or needs a MANAGER (financial roadmap Task 15, `abs(variance)` vs
        `FINANCE_APPROVAL_THRESHOLD_CASHIER_VARIANCE`), is decided inside
        `close_shift` itself against the freshly-locked shift — not here, and
        not by this view pre-computing the variance the way it used to. That
        keeps the rule enforced even for a direct service call outside DRF.
        This view keeps only the object-level scoping check (whose shift is
        this?), which is a different concern from the amount-based one.
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

            closed = services.close_shift(
                shift=locked,
                counted_amount=data["counted_amount"],
                closed_by=request.user,
                reason_code=data.get("reason_code", ""),
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


class EncounterPendingBillView(APIView):
    """GET /api/encounters/{encounter_id}/pending-bill/ — the Encounter's
    current accumulating DRAFT invoice (its `id` is what
    `POST /invoices/{id}/issue/` needs to check out), or `null` if nothing
    has been charged to this visit yet.

    Lives in `billing`, not `encounters`, even though the URL is keyed by
    encounter id: this only ever touches `Invoice` — never any clinical
    field on `Encounter` — and uses the same `IsSecretaryOrManager` gate
    every other billing endpoint already does.
    `apps.encounters.permissions.EncounterPermission` deliberately excludes
    Secretary from the clinical `EncounterViewSet` ("Secretaries have no
    access to encounters" — see that module's own docstring); this view is
    the one, narrowly-scoped, billing-only exception a Secretary needs for
    checkout, without punching a hole in that clinical boundary.
    """

    permission_classes = [IsSecretaryOrManager]

    def get(self, request, encounter_id):
        invoice = (
            Invoice.objects.filter(encounter_id=encounter_id, status=InvoiceStatus.DRAFT)
            .select_related("patient", "doctor")
            .prefetch_related("items")
            .first()
        )
        if invoice is None:
            return Response(None, status=status.HTTP_200_OK)
        return Response(InvoiceSerializer(invoice, context={"request": request}).data)


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
