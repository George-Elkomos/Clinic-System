"""Plain-language DRF exception handler (elder-friendly, no jargon).

Wraps DRF's default response in a consistent shape the frontend maps to friendly,
translatable messages:

    {"detail": "...", "code": "validation_error", "fields": {...}}
"""
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler

from apps.accounting.exceptions import AccountingError
from apps.billing.exceptions import BillingError

# Financial-domain invariant violations (financial roadmap Tasks 5-17) are
# deliberately plain `Exception` subclasses, not DRF's `ValidationError` — see
# each module's own exceptions.py docstring. A caller hitting one through the
# API (e.g. posting into a closed period, editing a closed shift) still needs
# a clean 400, not a raw 500 — this is the one place that translation happens,
# so no view needs its own try/except around a service call.
_DOMAIN_ERROR_TYPES = (AccountingError, BillingError)


def plain_language_exception_handler(exc, context):
    response = drf_exception_handler(exc, context)
    if response is None:
        if isinstance(exc, _DOMAIN_ERROR_TYPES):
            # A subclass may override the default 400/"business_rule_violation"
            # (e.g. the two idempotency-conflict exceptions are 409s) — see
            # each exception class's own `http_status`/`code` attributes.
            http_status = getattr(exc, "http_status", status.HTTP_400_BAD_REQUEST)
            code = getattr(exc, "code", "business_rule_violation")
            return Response({"code": code, "detail": str(exc)}, status=http_status)
        return None

    code = getattr(exc, "default_code", "error")
    payload = {"code": code}

    if isinstance(exc, ValidationError):
        # Field-level errors stay structured so the UI can highlight each field.
        payload["detail"] = "Please review the highlighted fields and try again."
        payload["fields"] = response.data
    else:
        data = response.data
        if isinstance(data, dict) and "detail" in data:
            payload["detail"] = str(data["detail"])
        else:
            payload["detail"] = "Something went wrong. Please try again."
            payload["fields"] = data

    response.data = payload
    return response
