"""Seed diagnosis categories + a curated ~50 ICD-10 diagnosis set, and fill ICD/
category/chronic data onto the diagnoses seeded in 0002. Delegates to the shared,
idempotent routine in services.seed_diagnoses."""
from django.db import migrations


def seed(apps, schema_editor):
    from apps.encounters.services import seed_diagnoses
    seed_diagnoses(apps)


def unseed(apps, schema_editor):
    # Categories are additive reference data; leave diagnoses in place (0002 owns
    # the originals). Only remove the categories this migration introduced.
    from apps.encounters.services import DIAGNOSIS_CATEGORIES
    DiagnosisCategory = apps.get_model("encounters", "DiagnosisCategory")
    DiagnosisCategory.objects.filter(name__in=[c[0] for c in DIAGNOSIS_CATEGORIES]).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("encounters", "0004_diagnosiscategory_diagnosis_icd10_code_and_more"),
    ]

    operations = [
        migrations.RunPython(seed, unseed),
    ]
