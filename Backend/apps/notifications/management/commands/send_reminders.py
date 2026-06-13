"""Send due appointment reminders (24h/1h) and expire stale waitlist holds.

One-shot (for Windows Task Scheduler / cron):
    python manage.py send_reminders

Demo loop (runs until interrupted):
    python manage.py send_reminders --loop --interval 60
"""
import time

from django.core.management.base import BaseCommand

from apps.notifications.services import expire_due_waitlist, send_due_reminders


class Command(BaseCommand):
    help = "Send due appointment reminders and expire stale waitlist holds."

    def add_arguments(self, parser):
        parser.add_argument("--loop", action="store_true", help="Run continuously.")
        parser.add_argument("--interval", type=int, default=60,
                            help="Seconds between runs when --loop is set.")

    def _run_once(self):
        counts = send_due_reminders()
        expired = expire_due_waitlist()
        self.stdout.write(self.style.SUCCESS(
            f"reminders 24h={counts['reminders_24h']} "
            f"1h={counts['reminders_1h']} | waitlist expired={expired}"
        ))

    def handle(self, *args, **options):
        if not options["loop"]:
            self._run_once()
            return
        interval = options["interval"]
        self.stdout.write(f"Reminder loop started (every {interval}s). Ctrl+C to stop.")
        try:
            while True:
                self._run_once()
                time.sleep(interval)
        except KeyboardInterrupt:
            self.stdout.write("Reminder loop stopped.")
