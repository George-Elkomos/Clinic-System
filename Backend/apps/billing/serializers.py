from decimal import Decimal

from rest_framework import serializers

from apps.core.enums import CashMovementType, PaymentMethod, RoleChoices
from apps.core.i18n import get_request_locale, localized_name
from apps.users.models import User

from .models import (
    CashierShift,
    CashMovement,
    CreditNote,
    FeeValidity,
    Invoice,
    InvoiceItem,
    Payment,
    Refund,
    ServiceItem,
)

# Cash handed back on a refund (`paid_by`) or a shift a manager closes always
# comes from a staff account — never a patient. Reused by every serializer
# below that accepts a user reference for financial-correction attribution.
_STAFF_ROLES = (RoleChoices.SECRETARY, RoleChoices.MANAGER)


class ServiceItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = ServiceItem
        fields = [
            "id", "name", "name_ar", "item_type", "default_price", "is_active",
        ]


class InvoiceItemSerializer(serializers.ModelSerializer):
    # `description` is a frozen English snapshot taken at invoice-creation time
    # (see billing/services.py) — when the line came from a catalog ServiceItem
    # that also has an Arabic name, prefer that under an Arabic locale rather
    # than adding a second frozen snapshot column.
    description = serializers.SerializerMethodField()

    class Meta:
        model = InvoiceItem
        fields = [
            "id", "description", "service_item", "quantity", "unit_price",
            "line_total", "source_type", "source_id",
        ]
        read_only_fields = ["line_total"]

    def get_description(self, obj):
        locale = get_request_locale(self.context.get("request"))
        if locale == "ar" and obj.service_item_id and obj.service_item.name_ar:
            return obj.service_item.name_ar
        return obj.description


class PaymentSerializer(serializers.ModelSerializer):
    received_by_name = serializers.SerializerMethodField()

    class Meta:
        model = Payment
        fields = [
            "id", "invoice", "paid_at", "amount", "payment_method",
            "reference", "received_by", "received_by_name",
        ]
        read_only_fields = ["paid_at", "received_by"]

    def get_received_by_name(self, obj):
        return obj.received_by.get_full_name() if obj.received_by else None


class PaymentCreateSerializer(serializers.ModelSerializer):
    """Input for POST /api/payments/ — the service layer applies the money."""

    class Meta:
        model = Payment
        fields = ["invoice", "amount", "payment_method", "reference"]


class InvoiceSerializer(serializers.ModelSerializer):
    number = serializers.CharField(read_only=True)
    patient_name = serializers.SerializerMethodField()
    doctor_name = serializers.SerializerMethodField()
    items = InvoiceItemSerializer(many=True, read_only=True)
    payments = PaymentSerializer(many=True, read_only=True)

    class Meta:
        model = Invoice
        fields = [
            "id", "number", "patient", "patient_name", "doctor", "doctor_name",
            "invoice_date", "due_date", "status", "subtotal", "discount",
            "total", "paid_amount", "credited_amount", "refunded_amount",
            "balance", "currency", "notes", "items", "payments",
        ]
        read_only_fields = [
            "invoice_date", "subtotal", "total", "paid_amount",
            "credited_amount", "refunded_amount", "balance",
        ]

    def get_patient_name(self, obj):
        locale = get_request_locale(self.context.get("request"))
        return localized_name(obj.patient, locale)

    def get_doctor_name(self, obj):
        locale = get_request_locale(self.context.get("request"))
        return localized_name(obj.doctor, locale)


class FeeValiditySerializer(serializers.ModelSerializer):
    class Meta:
        model = FeeValidity
        fields = [
            "id", "patient", "doctor", "invoice", "valid_from", "valid_until",
            "used_count", "max_free_visits",
        ]


# --- Task 7 API surface: credit notes, refunds, cancellation ------------------
# Input serializers deliberately never accept `approved_by`/`cancelled_by` —
# the view always supplies `request.user` for those (financial roadmap Task 15:
# never trust a client-supplied approver id). Only `paid_by` (refund cash
# attribution — distinct from who *approved* it) is client-settable, and even
# that is restricted to an existing staff account.

class CreditNoteCreateSerializer(serializers.Serializer):
    amount = serializers.DecimalField(
        max_digits=10, decimal_places=2, min_value=Decimal("0.01"),
    )
    reason_code = serializers.CharField(max_length=64)


class RefundCreateSerializer(serializers.Serializer):
    amount = serializers.DecimalField(
        max_digits=10, decimal_places=2, min_value=Decimal("0.01"),
    )
    payment_method = serializers.ChoiceField(choices=PaymentMethod.choices)
    reason_code = serializers.CharField(max_length=64)
    # Who physically hands the cash back — may differ from the approving
    # manager (services.issue_refund's own `paid_by` parameter). Optional:
    # the view defaults it to the requesting manager when omitted.
    paid_by = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.filter(role__in=_STAFF_ROLES),
        required=False, allow_null=True,
    )


class CancelInvoiceSerializer(serializers.Serializer):
    reason_code = serializers.CharField(max_length=64)


class CreditNoteSerializer(serializers.ModelSerializer):
    approved_by_name = serializers.SerializerMethodField()

    class Meta:
        model = CreditNote
        fields = [
            "id", "invoice", "amount", "reason_code",
            "approved_by", "approved_by_name", "journal_entry", "created_at",
        ]
        read_only_fields = fields

    def get_approved_by_name(self, obj):
        return obj.approved_by.get_full_name()


class RefundSerializer(serializers.ModelSerializer):
    approved_by_name = serializers.SerializerMethodField()

    class Meta:
        model = Refund
        fields = [
            "id", "invoice", "amount", "payment_method", "reason_code",
            "approved_by", "approved_by_name", "shift", "journal_entry", "created_at",
        ]
        read_only_fields = fields

    def get_approved_by_name(self, obj):
        return obj.approved_by.get_full_name()


# --- Task 11 API surface: cashier shifts --------------------------------------

class OpenShiftSerializer(serializers.Serializer):
    till_id = serializers.CharField(max_length=32, required=False)
    opening_float = serializers.DecimalField(
        max_digits=10, decimal_places=2, required=False, default=Decimal("0.00"),
    )


class CloseShiftSerializer(serializers.Serializer):
    counted_amount = serializers.DecimalField(
        max_digits=10, decimal_places=2, min_value=Decimal("0.00"),
    )
    reason_code = serializers.CharField(max_length=64, required=False, allow_blank=True, default="")
    notes = serializers.CharField(required=False, allow_blank=True, default="")


class CashierShiftSerializer(serializers.ModelSerializer):
    cashier_name = serializers.SerializerMethodField()
    closed_by_name = serializers.SerializerMethodField()
    approved_by_name = serializers.SerializerMethodField()

    class Meta:
        model = CashierShift
        fields = [
            "id", "cashier", "cashier_name", "till_id", "status",
            "opened_at", "closed_at", "closed_by", "closed_by_name",
            "opening_float", "expected_amount", "counted_amount", "variance",
            "variance_reason_code", "approved_by", "approved_by_name",
            "journal_entry", "currency", "notes",
        ]
        # Fully read-only via the serializer: every state change goes through
        # the `open`/`close` actions (services.open_shift/close_shift), never
        # a generic PATCH — a closed shift must not become editable through a
        # ModelViewSet's default update path (there isn't one registered, but
        # this also protects against a future accidental `CreateModelMixin`).
        read_only_fields = fields

    def get_cashier_name(self, obj):
        return obj.cashier.get_full_name()

    def get_closed_by_name(self, obj):
        return obj.closed_by.get_full_name() if obj.closed_by else None

    def get_approved_by_name(self, obj):
        return obj.approved_by.get_full_name() if obj.approved_by else None


# --- Task 17 API surface: cash movements --------------------------------------

class CashMovementCreateSerializer(serializers.Serializer):
    shift = serializers.PrimaryKeyRelatedField(queryset=CashierShift.objects.all())
    movement_type = serializers.ChoiceField(choices=CashMovementType.choices)
    amount = serializers.DecimalField(
        max_digits=10, decimal_places=2, min_value=Decimal("0.01"),
    )
    reason = serializers.CharField(max_length=255)


class CashMovementSerializer(serializers.ModelSerializer):
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = CashMovement
        fields = [
            "id", "shift", "movement_type", "amount", "reason",
            "created_by", "created_by_name", "journal_entry", "created_at",
        ]
        read_only_fields = fields

    def get_created_by_name(self, obj):
        return obj.created_by.get_full_name()
