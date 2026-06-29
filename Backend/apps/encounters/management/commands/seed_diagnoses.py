from django.core.management.base import BaseCommand

from apps.encounters.services import seed_diagnoses


class Command(BaseCommand):
    help = "Seed diagnosis categories and a curated set of ICD-10 coded diagnoses."

    def handle(self, *args, **options):
        counts = seed_diagnoses()
        self.stdout.write(self.style.SUCCESS(
            "Seeded diagnoses: "
            f"{counts['categories']} new categories, {counts['created']} new diagnoses, "
            f"{counts['updated']} existing diagnoses updated with ICD/category/chronic data."
        ))
