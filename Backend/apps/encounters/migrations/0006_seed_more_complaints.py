"""Seed the remaining curated complaints so the master list reaches ~80 entries.
Delegates to the shared, idempotent routine in services.seed_complaints."""
from django.db import migrations


def seed(apps, schema_editor):
    from apps.encounters.services import seed_complaints
    seed_complaints(apps)


def unseed(apps, schema_editor):
    # 0002 owns the original dozen; only remove the complaints this migration added.
    from apps.encounters.services import COMPLAINTS
    Complaint = apps.get_model("encounters", "Complaint")
    Complaint.objects.filter(name__in=[c[0] for c in COMPLAINTS]).exclude(
        name__in=[
            "Chest pain", "Palpitations", "Shortness of breath", "Cough",
            "Abdominal pain", "Nausea and vomiting", "Back pain", "Joint pain",
            "Headache", "Dizziness", "Fever", "Fatigue",
        ]
    ).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("encounters", "0005_seed_icd_diagnoses"),
    ]

    operations = [
        migrations.RunPython(seed, unseed),
    ]
