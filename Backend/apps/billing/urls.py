from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    BillingReportView,
    InvoiceViewSet,
    PaymentViewSet,
    ServiceItemViewSet,
)

router = DefaultRouter()
router.register("invoices", InvoiceViewSet, basename="invoice")
router.register("payments", PaymentViewSet, basename="payment")
router.register("service-items", ServiceItemViewSet, basename="service-item")

urlpatterns = [
    path("reports/billing/", BillingReportView.as_view(), name="reports-billing"),
    path("", include(router.urls)),
]
