from django.core.management.base import BaseCommand

from apps.medications.services import seed_reference_data


class Command(BaseCommand):
    help = "Seed medication classes, medications, dosage forms/patterns, and allergy alerts."

    def handle(self, *args, **options):
        counts = seed_reference_data()
        self.stdout.write(self.style.SUCCESS(
            "Seeded medication reference data: "
            f"{counts['classes']} classes, {counts['medications']} medications, "
            f"{counts['forms']} dosage forms, {counts['patterns']} patterns, "
            f"{counts['alerts']} allergy alerts (new rows only; existing left untouched)."
        ))
