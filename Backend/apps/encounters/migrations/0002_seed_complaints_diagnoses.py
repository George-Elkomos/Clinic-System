"""Seed a starter set of complaints and diagnoses per category so the
encounter comboboxes are populated out of the box."""
from django.db import migrations

COMPLAINTS = [
    ("Chest pain", "ألم في الصدر", "CARDIAC"),
    ("Palpitations", "خفقان", "CARDIAC"),
    ("Shortness of breath", "ضيق في التنفس", "RESPIRATORY"),
    ("Cough", "سعال", "RESPIRATORY"),
    ("Abdominal pain", "ألم في البطن", "GI"),
    ("Nausea and vomiting", "غثيان وقيء", "GI"),
    ("Back pain", "ألم في الظهر", "MUSCULOSKELETAL"),
    ("Joint pain", "ألم في المفاصل", "MUSCULOSKELETAL"),
    ("Headache", "صداع", "NEUROLOGICAL"),
    ("Dizziness", "دوخة", "NEUROLOGICAL"),
    ("Fever", "حمى", "OTHER"),
    ("Fatigue", "إرهاق", "OTHER"),
]

DIAGNOSES = [
    ("Hypertension", "ارتفاع ضغط الدم", "CARDIAC"),
    ("Atrial fibrillation", "الرجفان الأذيني", "CARDIAC"),
    ("Asthma", "الربو", "RESPIRATORY"),
    ("Pneumonia", "التهاب رئوي", "RESPIRATORY"),
    ("Gastritis", "التهاب المعدة", "GI"),
    ("Gastroenteritis", "التهاب المعدة والأمعاء", "GI"),
    ("Lower back strain", "إجهاد أسفل الظهر", "MUSCULOSKELETAL"),
    ("Osteoarthritis", "الفصال العظمي", "MUSCULOSKELETAL"),
    ("Migraine", "الصداع النصفي", "NEUROLOGICAL"),
    ("Tension headache", "صداع التوتر", "NEUROLOGICAL"),
    ("Viral infection", "عدوى فيروسية", "OTHER"),
    ("Type 2 diabetes mellitus", "السكري من النوع الثاني", "OTHER"),
]


def seed(apps, schema_editor):
    Complaint = apps.get_model("encounters", "Complaint")
    Diagnosis = apps.get_model("encounters", "Diagnosis")
    for name, name_ar, category in COMPLAINTS:
        Complaint.objects.get_or_create(
            name=name, defaults={"name_ar": name_ar, "category": category}
        )
    for name, name_ar, category in DIAGNOSES:
        Diagnosis.objects.get_or_create(
            name=name, defaults={"name_ar": name_ar, "category": category}
        )


def unseed(apps, schema_editor):
    Complaint = apps.get_model("encounters", "Complaint")
    Diagnosis = apps.get_model("encounters", "Diagnosis")
    Complaint.objects.filter(name__in=[c[0] for c in COMPLAINTS]).delete()
    Diagnosis.objects.filter(name__in=[d[0] for d in DIAGNOSES]).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("encounters", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(seed, unseed),
    ]
