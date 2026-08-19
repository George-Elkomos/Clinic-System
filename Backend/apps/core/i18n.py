"""Per-request locale resolution + bilingual name fallback, shared by every
serializer that renders a person's name (Encounters, Invoices, AuditLogs,
Reviews, Appointments, ...).
"""


def get_request_locale(request) -> str:
    """'ar' if the request's Accept-Language prefers Arabic, else 'en'."""
    header = request.headers.get("Accept-Language", "") if request is not None else ""
    primary = header.split(",")[0].split(";")[0].split("-")[0].strip().lower()
    return "ar" if primary == "ar" else "en"


def localized_name(user, locale: str) -> str | None:
    """The best available display name for `user` in `locale`, falling back
    through the other language, then the pre-existing first/last name, then
    email — never returns an empty response just because a translation is
    missing."""
    if user is None:
        return None
    if locale == "ar":
        return user.name_ar or user.name_en or user.get_full_name() or user.email
    return user.name_en or user.name_ar or user.get_full_name() or user.email
