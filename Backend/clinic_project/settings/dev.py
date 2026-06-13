"""Development settings."""
from .base import *  # noqa: F401,F403

DEBUG = True

# Convenience: allow all localhost origins during development.
CORS_ALLOW_ALL_ORIGINS = False  # keep explicit so credentialed CORS works correctly
