from rest_framework import serializers

from apps.core.i18n import get_request_locale, localized_name

from .models import FeeValidity, Invoice, InvoiceItem, Payment, ServiceItem


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
            "total", "paid_amount", "balance", "currency", "notes",
            "items", "payments",
        ]
        read_only_fields = [
            "invoice_date", "subtotal", "total", "paid_amount", "balance",
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
