"""Expire unconfirmed bookings and mark overdue confirmed appointments as
no-show. Both sweeps are silent to the patient; the desk gets an in-app alert.

One-shot (for Windows Task Scheduler / cron):
    python manage.py expire_appointments

Demo loop (runs until interrupted):
    python manage.py expire_appointments --loop --interval 60
"""
import time

from django.core.management.base import BaseCommand

from apps.appointments.services import expire_due_appointments, mark_overdue_no_shows


class Command(BaseCommand):
    help = "Expire unconfirmed PENDING bookings and mark overdue CONFIRMED appointments as no-show."

    def add_arguments(self, parser):
        parser.add_argument("--loop", action="store_true", help="Run continuously.")
        parser.add_argument("--interval", type=int, default=60,
                            help="Seconds between runs when --loop is set.")

    def _run_once(self):
        expired = expire_due_appointments()
        no_shows = mark_overdue_no_shows()
        self.stdout.write(self.style.SUCCESS(
            f"expired={expired} no_show={no_shows}"
        ))

    def handle(self, *args, **options):
        if not options["loop"]:
            self._run_once()
            return
        interval = options["interval"]
        self.stdout.write(f"Auto-expiry loop started (every {interval}s). Ctrl+C to stop.")
        try:
            while True:
                self._run_once()
                time.sleep(interval)
        except KeyboardInterrupt:
            self.stdout.write("Auto-expiry loop stopped.")
