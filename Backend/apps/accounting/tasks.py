"""Django-Q entry point for the revenue-integrity job (financial roadmap
Task 16). Registered as a recurring Schedule — see the
0004_schedule_revenue_integrity_check migration — running on the existing
`qcluster` worker, matching the same convention as
`apps.appointments.tasks.run_expiry_sweep`.

Detect-only: this wrapper adds nothing beyond logging. It never corrects
anything the check finds — see `apps.accounting.integrity` for the actual
checks and the read-only guarantee.
"""
import logging

from . import integrity

logger = logging.getLogger(__name__)


def run_revenue_integrity_check():
    """Run the integrity check and log a summary. Returns the same
    structured result `integrity.run_revenue_integrity_check()` produces —
    nothing added, nothing hidden, so this is exactly as useful to call
    directly (from a shell, a test, an admin action) as it is as a Schedule
    target."""
    result = integrity.run_revenue_integrity_check()
    summary = result["summary"]

    if result["ok"]:
        logger.info(
            "Revenue integrity check: OK (%d checks run, 0 findings).",
            summary["checks_run"],
        )
    else:
        log = logger.error if summary["critical"] or summary["checks_failed"] else logger.warning
        log(
            "Revenue integrity check: %d finding(s) (%d critical, %d warning); "
            "%d/%d checks failed to run.",
            summary["total_findings"], summary["critical"], summary["warning"],
            summary["checks_failed"], summary["checks_run"],
        )
    return result
