"""Seed dosage forms/patterns, medication classes, a curated ~50-drug set, and
drug-allergy alerts so the prescription comboboxes + interaction check work out of
the box. Delegates to the shared, idempotent routine in services.seed_reference_data."""
from django.db import migrations


def seed(apps, schema_editor):
    from apps.medications.services import seed_reference_data
    seed_reference_data(apps)


def unseed(apps, schema_editor):
    from apps.medications.services import (
        ALLERGY_ALERTS, DOSAGE_FORMS, DOSAGE_PATTERNS, MEDICATION_CLASSES, MEDICATIONS,
    )
    AllergyAlert = apps.get_model("medications", "AllergyAlert")
    Medication = apps.get_model("medications", "Medication")
    MedicationClass = apps.get_model("medications", "MedicationClass")
    DosageForm = apps.get_model("medications", "DosageForm")
    DosagePattern = apps.get_model("medications", "DosagePattern")

    AllergyAlert.objects.filter(allergy_keyword__in=[a[0] for a in ALLERGY_ALERTS]).delete()
    Medication.objects.filter(name__in=[m[0] for m in MEDICATIONS]).delete()
    MedicationClass.objects.filter(name__in=[c[0] for c in MEDICATION_CLASSES]).delete()
    DosageForm.objects.filter(name__in=[f[0] for f in DOSAGE_FORMS]).delete()
    DosagePattern.objects.filter(name__in=[p[0] for p in DOSAGE_PATTERNS]).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("medications", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(seed, unseed),
    ]
