"""
Base Django settings for the Clinic Management System.

Shared by dev.py and prod.py. Config is read from a .env file via django-environ.
"""
from datetime import timedelta
from pathlib import Path

import environ

# BASE_DIR = .../Backend
BASE_DIR = Path(__file__).resolve().parent.parent.parent

env = environ.Env(
    DEBUG=(bool, False),
    ALLOWED_HOSTS=(list, ["localhost", "127.0.0.1"]),
    CORS_ALLOWED_ORIGINS=(list, ["http://localhost:5173"]),
    JWT_COOKIE_SECURE=(bool, None),  # default resolved below after DEBUG is known
    JWT_COOKIE_SAMESITE=(str, "Lax"),
    ACCESS_TOKEN_LIFETIME_MINUTES=(int, 30),
    REFRESH_TOKEN_LIFETIME_DAYS=(int, 7),
    SMS_ENABLED=(bool, False),
    WHATSAPP_ENABLED=(bool, False),
    SLOT_HORIZON_DAYS=(int, 60),
    CANCELLATION_WINDOW_HOURS=(int, 4),
    REMINDER_24H_WINDOW_MINUTES=(int, 30),
    REMINDER_1H_WINDOW_MINUTES=(int, 15),
    WAITLIST_HOLD_HOURS=(int, 24),
    CLINIC_NAME=(str, "Sunrise Family Clinic"),
    BILLING_FOLLOWUP_DAYS=(int, 14),
    BILLING_INVOICE_DUE_DAYS=(int, 7),
    BILLING_DEFAULT_CONSULTATION_PRICE=(str, "50.00"),
    BILLING_CURRENCY=(str, "USD"),
)

# Read .env if present (sibling of manage.py).
environ.Env.read_env(BASE_DIR / ".env")

SECRET_KEY = env("SECRET_KEY")  # No default — raises ImproperlyConfigured if missing from .env
DEBUG = env("DEBUG")
ALLOWED_HOSTS = env("ALLOWED_HOSTS")

# --- Applications -----------------------------------------------------------
DJANGO_APPS = [
    # "daphne" must load before "staticfiles" — it patches `runserver` to serve
    # ASGI (HTTP + WebSocket) instead of plain WSGI, with zero change to how
    # dev.ps1 launches the backend (still `manage.py runserver`).
    "daphne",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
]

THIRD_PARTY_APPS = [
    "rest_framework",
    "rest_framework_simplejwt",
    "rest_framework_simplejwt.token_blacklist",
    "corsheaders",
    "django_filters",
    "simple_history",
    "django_q",
    "channels",
]

LOCAL_APPS = [
    "apps.core",
    "apps.users",
    "apps.doctors",
    "apps.appointments",
    "apps.medical_records",
    "apps.reviews",
    "apps.notifications",
    "apps.reports",
    "apps.audit",
    "apps.vital_signs",   # Phase 5
    "apps.ai_scribe",     # AI medical scribe (voice -> transcript -> structured draft)
    "apps.encounters",    # Phase 8 — structured clinical encounter
    "apps.medications",   # Phase 9 — medication master + drug-allergy alerts
    "apps.billing",       # Phase 12 — invoices, payments, fee validity
    "apps.referrals",     # Phase 13 — referrals + complaints master
]

INSTALLED_APPS = DJANGO_APPS + THIRD_PARTY_APPS + LOCAL_APPS

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    # Captures the request actor for the audit log (thread-local).
    "apps.core.middleware.CurrentUserMiddleware",
    "simple_history.middleware.HistoryRequestMiddleware",
]

ROOT_URLCONF = "clinic_project.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "clinic_project.wsgi.application"
ASGI_APPLICATION = "clinic_project.asgi.application"

# --- Database ---------------------------------------------------------------
# SQLite by default. WAL mode + busy timeout + FK enforcement are applied via
# the connection_created signal in apps/core/apps.py (works across SQLite setups).
DATABASES = {"default": env.db("DATABASE_URL", default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}")}
DATABASES["default"].setdefault("OPTIONS", {})
DATABASES["default"]["OPTIONS"]["timeout"] = 20

# --- Auth -------------------------------------------------------------------
AUTH_USER_MODEL = "users.User"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# --- DRF --------------------------------------------------------------------
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": (
        "rest_framework.permissions.IsAuthenticated",
    ),
    "DEFAULT_PAGINATION_CLASS": "apps.core.pagination.DefaultPagination",
    "PAGE_SIZE": 20,
    "DEFAULT_FILTER_BACKENDS": (
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ),
    "EXCEPTION_HANDLER": "apps.core.exceptions.plain_language_exception_handler",
    "DEFAULT_RENDERER_CLASSES": (
        "rest_framework.renderers.JSONRenderer",
        "rest_framework.renderers.BrowsableAPIRenderer",  # stripped in prod.py
    ),
}

# --- SimpleJWT --------------------------------------------------------------
SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=env("ACCESS_TOKEN_LIFETIME_MINUTES")),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=env("REFRESH_TOKEN_LIFETIME_DAYS")),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "UPDATE_LAST_LOGIN": True,
    "AUTH_HEADER_TYPES": ("Bearer",),
}

# Name + flags for the httpOnly refresh cookie (set/cleared by auth views).
# JWT_COOKIE_SECURE defaults to False when DEBUG=True (plain-HTTP localhost) and
# True when DEBUG=False (production HTTPS).  Override via JWT_COOKIE_SECURE in .env.
JWT_REFRESH_COOKIE = "clinic_refresh"
_jwt_secure_raw = env("JWT_COOKIE_SECURE", default=None)
JWT_COOKIE_SECURE = _jwt_secure_raw if _jwt_secure_raw is not None else (not DEBUG)
JWT_COOKIE_SAMESITE = env("JWT_COOKIE_SAMESITE")
JWT_COOKIE_PATH = "/api/auth/"

# --- CORS -------------------------------------------------------------------
CORS_ALLOWED_ORIGINS = env("CORS_ALLOWED_ORIGINS")
CORS_ALLOW_CREDENTIALS = True

# --- I18N -------------------------------------------------------------------
LANGUAGE_CODE = "en"
LANGUAGES = [("en", "English"), ("ar", "Arabic")]
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

# --- Static / media ---------------------------------------------------------
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"

# Upload guards (scans/labs can be large; reject oversized in-memory payloads).
DATA_UPLOAD_MAX_MEMORY_SIZE = 25 * 1024 * 1024  # 25 MB
FILE_UPLOAD_MAX_MEMORY_SIZE = 25 * 1024 * 1024
MAX_UPLOAD_SIZE = 25 * 1024 * 1024

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --- Email ------------------------------------------------------------------
EMAIL_BACKEND = env("EMAIL_BACKEND", default="django.core.mail.backends.console.EmailBackend")
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", default="clinic@example.com")
EMAIL_HOST = env("EMAIL_HOST", default="")
EMAIL_PORT = env.int("EMAIL_PORT", default=587)
EMAIL_USE_TLS = env.bool("EMAIL_USE_TLS", default=True)
EMAIL_HOST_USER = env("EMAIL_HOST_USER", default="")
EMAIL_HOST_PASSWORD = env("EMAIL_HOST_PASSWORD", default="")

# --- Notifications / SMS ----------------------------------------------------
SMS_ENABLED = env("SMS_ENABLED")
WHATSAPP_ENABLED = env("WHATSAPP_ENABLED")
TWILIO_ACCOUNT_SID = env("TWILIO_ACCOUNT_SID", default="")
TWILIO_AUTH_TOKEN = env("TWILIO_AUTH_TOKEN", default="")   # main Auth Token OR API Key Secret
TWILIO_API_KEY = env("TWILIO_API_KEY", default="")         # API Key SID (SK...) — if set, use API Key auth
TWILIO_FROM_NUMBER = env("TWILIO_FROM_NUMBER", default="")
TWILIO_WHATSAPP_FROM = env("TWILIO_WHATSAPP_FROM", default="")

# --- Domain knobs -----------------------------------------------------------
SLOT_HORIZON_DAYS = env("SLOT_HORIZON_DAYS")
CANCELLATION_WINDOW_HOURS = env("CANCELLATION_WINDOW_HOURS")
REMINDER_24H_WINDOW_MINUTES = env("REMINDER_24H_WINDOW_MINUTES")
REMINDER_1H_WINDOW_MINUTES = env("REMINDER_1H_WINDOW_MINUTES")
WAITLIST_HOLD_HOURS = env("WAITLIST_HOLD_HOURS")
CLINIC_NAME = env("CLINIC_NAME")

# --- Billing (Phase 12) -------------------------------------------------------
BILLING_FOLLOWUP_DAYS = env("BILLING_FOLLOWUP_DAYS")            # free follow-up window
BILLING_INVOICE_DUE_DAYS = env("BILLING_INVOICE_DUE_DAYS")      # invoice_date -> due_date
BILLING_DEFAULT_CONSULTATION_PRICE = env("BILLING_DEFAULT_CONSULTATION_PRICE")
BILLING_CURRENCY = env("BILLING_CURRENCY")

# --- AI Scribe (apps/ai_scribe) ---------------------------------------------
# Records a doctor-patient session -> Whisper transcript -> Gemini structured
# draft the doctor reviews and confirms. All heavy deps are imported lazily, so
# the app boots even if faster-whisper / google-genai are not installed yet.
AI_SCRIBE_ENABLED = env("AI_SCRIBE_ENABLED", default=True)

# Speech-to-text (faster-whisper, runs locally / offline).
# large-v3 is the most accurate for Egyptian Arabic but heavy on CPU; drop to
# "medium" or "small" via .env if transcription is too slow on this machine.
WHISPER_MODEL_SIZE = env("WHISPER_MODEL_SIZE", default="large-v3")
WHISPER_DEVICE = env("WHISPER_DEVICE", default="cpu")          # "cpu" or "cuda"
WHISPER_COMPUTE_TYPE = env("WHISPER_COMPUTE_TYPE", default="int8")  # int8=CPU-friendly; float16 for GPU
WHISPER_DEFAULT_LANGUAGE = env("WHISPER_DEFAULT_LANGUAGE", default="ar")
WHISPER_MODEL_DIR = env("WHISPER_MODEL_DIR", default=str(BASE_DIR / "media" / "whisper_models"))
AI_SCRIBE_MAX_AUDIO_MB = env.int("AI_SCRIBE_MAX_AUDIO_MB", default=80)

# Structured extraction (Google Gemini — free tier key from aistudio.google.com).
GEMINI_API_KEY = env("GEMINI_API_KEY", default="")
GEMINI_MODEL = env("GEMINI_MODEL", default="gemini-2.0-flash")

# --- Background task queue (Django-Q2) ---------------------------------------
# Replaces ad-hoc threading.Thread / inline dispatch for slow off-request work
# (AI Scribe transcription, outbound email/SMS/WhatsApp) with a real worker
# queue. Uses the existing Django ORM as the broker — no Redis/RabbitMQ to
# install or run, matching this project's "minimal infrastructure" stance.
# Run the worker locally with:  python manage.py qcluster  (dev.ps1 starts it).
Q_CLUSTER = {
    "name": "clinic",
    "orm": "default",
    "workers": env.int("Q_CLUSTER_WORKERS", default=2),
    "recycle": 500,
    "timeout": 300,          # kill a task if it runs past 5 minutes
    "retry": 360,            # must exceed timeout or django-q refuses to start
    "max_attempts": 3,
    "retry_backoff": True,
    "save_limit": 500,       # keep the last N successful task results
    "catch_up": False,       # don't replay tasks missed while no worker ran
    "sync": env.bool("Q_CLUSTER_SYNC", default=False),  # True executes inline (tests)
}

# --- Real-time updates (Django Channels) -------------------------------------
# Pushes queue-change events to the doctor's live queue page instead of the
# frontend polling every 15s. In-memory channel layer — correct and sufficient
# as long as the backend runs as a SINGLE process (true today: one `runserver`/
# daphne process via dev.ps1). It does NOT work across multiple worker
# processes/machines (each has its own isolated memory) — if this ever scales
# past one process, swap to `channels_redis.core.RedisChannelLayer` (same
# "add Redis when you actually need it" tradeoff as Celery vs Django-Q above).
CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels.layers.InMemoryChannelLayer",
    },
}
