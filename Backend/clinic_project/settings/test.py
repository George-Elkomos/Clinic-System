"""Test settings. Runs Django-Q tasks inline (synchronously) so the test suite
never depends on a real `qcluster` worker process being started."""
from .dev import *  # noqa: F401,F403
from .dev import Q_CLUSTER  # noqa: F401 — explicit so the override is visible

Q_CLUSTER = {**Q_CLUSTER, "sync": True}

# Tests only. MD5 is not a secure hasher — it is used here solely because
# Django's default PBKDF2 hasher runs ~600,000 iterations per user, and the
# suite creates roughly a thousand users via the `make_user` fixture. This
# module is imported only by pytest (see pytest.ini DJANGO_SETTINGS_MODULE);
# prod.py never sees it.
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
