from django.contrib import admin

from .models import FeeValidity, Invoice, InvoiceItem, Payment, ServiceItem


@admin.register(ServiceItem)
class ServiceItemAdmin(admin.ModelAdmin):
    list_display = ["name", "item_type", "default_price", "is_active"]
    list_filter = ["item_type", "is_active"]
    search_fields = ["name", "name_ar"]


class InvoiceItemInline(admin.TabularInline):
    model = InvoiceItem
    extra = 0
    readonly_fields = ["line_total"]
    raw_id_fields = ["service_item"]


class PaymentInline(admin.TabularInline):
    model = Payment
    extra = 0
    readonly_fields = ["paid_at"]
    raw_id_fields = ["received_by"]


@admin.register(Invoice)
class InvoiceAdmin(admin.ModelAdmin):
    list_display = [
        "number", "patient", "doctor", "invoice_date", "status",
        "total", "paid_amount", "balance",
    ]
    list_filter = ["status", "invoice_date"]
    search_fields = ["patient__email", "patient__first_name", "patient__last_name"]
    raw_id_fields = ["patient", "doctor"]
    readonly_fields = ["balance", "invoice_date"]
    inlines = [InvoiceItemInline, PaymentInline]


@admin.register(Payment)
class PaymentAdmin(admin.ModelAdmin):
    list_display = ["invoice", "amount", "payment_method", "paid_at", "received_by"]
    list_filter = ["payment_method", "paid_at"]
    raw_id_fields = ["invoice", "received_by"]


@admin.register(FeeValidity)
class FeeValidityAdmin(admin.ModelAdmin):
    list_display = [
        "patient", "doctor", "valid_from", "valid_until", "used_count", "max_free_visits",
    ]
    list_filter = ["valid_from", "valid_until"]
    raw_id_fields = ["patient", "doctor", "invoice"]
