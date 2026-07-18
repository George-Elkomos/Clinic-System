"""Test settings. Runs Django-Q tasks inline (synchronously) so the test suite
never depends on a real `qcluster` worker process being started."""
from .dev import *  # noqa: F401,F403
from .dev import Q_CLUSTER  # noqa: F401 — explicit so the override is visible

Q_CLUSTER = {**Q_CLUSTER, "sync": True}
