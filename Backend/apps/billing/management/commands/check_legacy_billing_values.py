"""Pre-merge blocker resolution — read-only production legacy-data check.

Billing migration 0007 narrowed `InvoiceItem.source_type` and
`ServiceItem.item_type`'s choices, removing `PRESCRIPTION`/`MEDICATION`
(added in migration 0006 and reverted the same day, ~2.5 hours later — no
code in this repo's history has ever set either value). Choices on a
Django `CharField` are not DB-enforced, so `0007` could not have rejected an
existing row; this command exists to actually confirm the count rather than
infer it from code history alone.

Strictly read-only: two `.count()` queries, nothing else. Never writes,
never deletes, never touches any other table. Safe to run directly against
production, e.g.:

    python manage.py check_legacy_billing_values

or, without a persistent shell, from a deploy-adjacent one-off:

    cd /var/www/clinic_app/Backend && source venv/bin/activate
    python manage.py check_legacy_billing_values
"""
from django.core.management.base import BaseCommand

from apps.billing.models import InvoiceItem, ServiceItem


class Command(BaseCommand):
    help = (
        "Read-only: counts InvoiceItem rows with the legacy source_type="
        "'PRESCRIPTION' and ServiceItem rows with the legacy item_type="
        "'MEDICATION' (both removed from choices in billing migration 0007). "
        "Prints counts only — never modifies anything."
    )

    def handle(self, *args, **options):
        prescription_count = InvoiceItem.objects.filter(source_type="PRESCRIPTION").count()
        medication_count = ServiceItem.objects.filter(item_type="MEDICATION").count()

        self.stdout.write(f"InvoiceItem(source_type='PRESCRIPTION'): {prescription_count}")
        self.stdout.write(f"ServiceItem(item_type='MEDICATION'): {medication_count}")

        if prescription_count == 0 and medication_count == 0:
            self.stdout.write(self.style.SUCCESS(
                "No legacy PRESCRIPTION/MEDICATION rows found — migration 0007's "
                "narrowed choices are not masking any existing data."
            ))
        else:
            self.stdout.write(self.style.WARNING(
                "Legacy rows found — review before relying on the current "
                "InvoiceItem.source_type/ServiceItem.item_type choice sets."
            ))
