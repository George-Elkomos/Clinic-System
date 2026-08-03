"""Production settings. Tighten security; expects real env values."""
from .base import *  # noqa: F401,F403
from .base import REST_FRAMEWORK  # noqa: F401 — explicit so the override is visible

DEBUG = False

# HTTPS / cookie hardening — default True (real HTTPS deployments), env-gated so
# an HTTP-only/IP-only deployment (no TLS cert yet) can flip these to False in
# .env instead of getting an unreachable redirect loop.
SECURE_SSL_REDIRECT = env.bool("SECURE_SSL_REDIRECT", default=True)
SESSION_COOKIE_SECURE = env.bool("SESSION_COOKIE_SECURE", default=True)
CSRF_COOKIE_SECURE = env.bool("CSRF_COOKIE_SECURE", default=True)
SECURE_HSTS_SECONDS = env.int("SECURE_HSTS_SECONDS", default=60 * 60 * 24 * 30)
SECURE_HSTS_INCLUDE_SUBDOMAINS = env.bool("SECURE_HSTS_INCLUDE_SUBDOMAINS", default=True)
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# JWT_COOKIE_SECURE defaults to True in base.py — no override needed here.
# EXTENSION HOOK: swap SQLite for PostgreSQL by setting DATABASE_URL=postgres://...

# SEC-5: Strip the interactive browsable API from production — JSON-only.
REST_FRAMEWORK["DEFAULT_RENDERER_CLASSES"] = (
    "rest_framework.renderers.JSONRenderer",
)
