"""Financial roadmap Task 15 — startup validation for the approval-threshold
settings. A malformed or negative threshold must fail loudly (via
`manage.py check`, which every deploy/test run already exercises) rather than
be silently coerced or crash lazily the first time a correction is
attempted."""
from decimal import Decimal, InvalidOperation

from django.conf import settings
from django.core.checks import Error, register

_THRESHOLD_SETTINGS = (
    "FINANCE_APPROVAL_THRESHOLD_REFUND",
    "FINANCE_APPROVAL_THRESHOLD_CREDIT_NOTE",
    "FINANCE_APPROVAL_THRESHOLD_WRITE_OFF",
    "FINANCE_APPROVAL_THRESHOLD_CASHIER_VARIANCE",
)


@register()
def check_finance_approval_thresholds(app_configs, **kwargs):
    errors = []
    for name in _THRESHOLD_SETTINGS:
        raw = getattr(settings, name, None)
        try:
            value = Decimal(raw)
        except (InvalidOperation, TypeError, ValueError):
            errors.append(Error(
                f"settings.{name} is not a valid decimal amount: {raw!r}.",
                hint="Use a plain decimal string, e.g. \"0.00\" or \"250.00\" — never a float.",
                id="billing.E001",
            ))
            continue
        if value < 0:
            errors.append(Error(
                f"settings.{name} must be >= 0, got {value}.",
                id="billing.E002",
            ))
    return errors
