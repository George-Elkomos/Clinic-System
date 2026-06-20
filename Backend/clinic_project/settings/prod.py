"""Production settings. Tighten security; expects real env values."""
from .base import *  # noqa: F401,F403
from .base import REST_FRAMEWORK  # noqa: F401 — explicit so the override is visible

DEBUG = False

# HTTPS / cookie hardening (set via env in real deployments).
SECURE_SSL_REDIRECT = True
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_HSTS_SECONDS = 60 * 60 * 24 * 30
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# JWT_COOKIE_SECURE defaults to True in base.py — no override needed here.
# EXTENSION HOOK: swap SQLite for PostgreSQL by setting DATABASE_URL=postgres://...

# SEC-5: Strip the interactive browsable API from production — JSON-only.
REST_FRAMEWORK["DEFAULT_RENDERER_CLASSES"] = (
    "rest_framework.renderers.JSONRenderer",
)
