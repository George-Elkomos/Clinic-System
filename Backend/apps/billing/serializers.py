from rest_framework import serializers

from .models import FeeValidity, Invoice, InvoiceItem, Payment, ServiceItem


class ServiceItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = ServiceItem
        fields = [
            "id", "name", "name_ar", "item_type", "default_price", "is_active",
        ]


class InvoiceItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = InvoiceItem
        fields = [
            "id", "description", "service_item", "quantity", "unit_price",
            "line_total", "source_type", "source_id",
        ]
        read_only_fields = ["line_total"]


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
        return obj.patient.get_full_name() or obj.patient.email

    def get_doctor_name(self, obj):
        return (obj.doctor.get_full_name() or obj.doctor.email) if obj.doctor else None


class FeeValiditySerializer(serializers.ModelSerializer):
    class Meta:
        model = FeeValidity
        fields = [
            "id", "patient", "doctor", "invoice", "valid_from", "valid_until",
            "used_count", "max_free_visits",
        ]
