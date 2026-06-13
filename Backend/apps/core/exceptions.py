"""Plain-language DRF exception handler (elder-friendly, no jargon).

Wraps DRF's default response in a consistent shape the frontend maps to friendly,
translatable messages:

    {"detail": "...", "code": "validation_error", "fields": {...}}
"""
from rest_framework.exceptions import ValidationError
from rest_framework.views import exception_handler as drf_exception_handler


def plain_language_exception_handler(exc, context):
    response = drf_exception_handler(exc, context)
    if response is None:
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
