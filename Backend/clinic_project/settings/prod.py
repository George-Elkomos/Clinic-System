"""Production settings. Tighten security; expects real env values."""
from .base import *  # noqa: F401,F403

DEBUG = False

# HTTPS / cookie hardening (set via env in real deployments).
SECURE_SSL_REDIRECT = True
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_HSTS_SECONDS = 60 * 60 * 24 * 30
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# NOTE: For a cross-site SPA over HTTPS, set JWT_COOKIE_SECURE=True and
# JWT_COOKIE_SAMESITE=None in the environment so the refresh cookie is sent.
# EXTENSION HOOK: swap SQLite for PostgreSQL by setting DATABASE_URL=postgres://...
