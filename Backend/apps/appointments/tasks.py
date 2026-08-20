"""Django-Q entry points. Registered as a recurring Schedule (see the
0005_schedule_expiry_sweep migration) so it runs on the existing `qcluster`
worker with no separate cron/Task Scheduler entry — matching this project's
minimal-infrastructure stance (see Q_CLUSTER in settings/base.py)."""
from . import services


def run_expiry_sweep():
    """Expire overdue PENDING bookings and mark overdue CONFIRMED appointments
    as no-show. Safe to call repeatedly — both sweeps only act on rows past
    their grace window."""
    expired = services.expire_due_appointments()
    no_shows = services.mark_overdue_no_shows()
    return {"expired": expired, "no_show": no_shows}
