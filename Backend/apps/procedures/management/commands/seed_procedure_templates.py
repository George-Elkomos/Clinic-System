from django.core.management.base import BaseCommand

from apps.procedures.services import seed_procedure_templates


class Command(BaseCommand):
    help = "Seed the master ProcedureTemplate catalog (minor surgery, injection, dressing, biopsy, other)."

    def handle(self, *args, **options):
        counts = seed_procedure_templates()
        self.stdout.write(self.style.SUCCESS(
            f"Seeded procedure templates: {counts['created']} created, {counts['updated']} updated."
        ))
