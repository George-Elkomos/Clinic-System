from django.core.management.base import BaseCommand

from apps.encounters.services import seed_complaints


class Command(BaseCommand):
    help = "Seed a curated ~80-entry bilingual complaint master list."

    def handle(self, *args, **options):
        counts = seed_complaints()
        self.stdout.write(self.style.SUCCESS(
            f"Seeded complaints: {counts['created']} new, {counts['updated']} already present."
        ))
