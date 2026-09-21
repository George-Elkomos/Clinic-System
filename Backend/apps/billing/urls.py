from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    BillingReportView,
    BillingSummaryView,
    CashierShiftViewSet,
    CashMovementViewSet,
    InvoiceViewSet,
    PaymentViewSet,
    ServiceItemViewSet,
    WriteOffViewSet,
)

router = DefaultRouter()
router.register("invoices", InvoiceViewSet, basename="invoice")
router.register("payments", PaymentViewSet, basename="payment")
router.register("service-items", ServiceItemViewSet, basename="service-item")
router.register("cashier-shifts", CashierShiftViewSet, basename="cashier-shift")
router.register("cash-movements", CashMovementViewSet, basename="cash-movement")
router.register("write-offs", WriteOffViewSet, basename="write-off")

urlpatterns = [
    path("reports/billing/", BillingReportView.as_view(), name="reports-billing"),
    path("reports/billing-summary/", BillingSummaryView.as_view(), name="reports-billing-summary"),
    path("", include(router.urls)),
]
