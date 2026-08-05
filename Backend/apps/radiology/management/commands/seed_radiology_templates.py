from django.core.management.base import BaseCommand

from apps.radiology.services import seed_radiology_templates


class Command(BaseCommand):
    help = "Seed the master RadiologyTemplate catalog (Chest X-Ray, Abdominal Ultrasound, Head CT, Knee MRI, PET-CT, Other)."

    def handle(self, *args, **options):
        counts = seed_radiology_templates()
        self.stdout.write(self.style.SUCCESS(
            f"Seeded radiology templates: {counts['created']} created, {counts['updated']} updated."
        ))
