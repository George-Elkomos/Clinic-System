from django.db import migrations


def backfill_currency_egp(apps, schema_editor):
    Invoice = apps.get_model("billing", "Invoice")
    Invoice.objects.filter(currency="USD").update(currency="EGP")


def backfill_currency_usd(apps, schema_editor):
    Invoice = apps.get_model("billing", "Invoice")
    Invoice.objects.filter(currency="EGP").update(currency="USD")


class Migration(migrations.Migration):

    dependencies = [
        ("billing", "0002_invoice_currency_default_egp"),
    ]

    operations = [
        migrations.RunPython(backfill_currency_egp, backfill_currency_usd),
    ]
