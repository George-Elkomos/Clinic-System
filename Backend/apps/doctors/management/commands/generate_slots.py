from django.core.management.base import BaseCommand

from apps.doctors.services import slot_generator


class Command(BaseCommand):
    help = "Generate bookable time slots for all doctors across the rolling horizon."

    def add_argument(self, parser):  # pragma: no cover
        pass

    def add_arguments(self, parser):
        parser.add_argument(
            "--days", type=int, default=None,
            help="Horizon in days (defaults to SLOT_HORIZON_DAYS).",
        )

    def handle(self, *args, **options):
        created = slot_generator.generate_all(horizon_days=options.get("days"))
        self.stdout.write(self.style.SUCCESS(f"Generated {created} new slot(s)."))
