from django.apps import AppConfig


class BillingConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.billing"
    verbose_name = "Billing & Payments"

    def ready(self):
        from . import checks  # noqa: F401 — registers the Task 15 threshold checks
