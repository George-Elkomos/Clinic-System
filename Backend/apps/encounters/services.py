"""Encounter lifecycle services.

State machine:
    DRAFT --submit--> SUBMITTED --amend--> (original: AMENDED, not current)
                                          + new editable DRAFT twin (version+1)

Submitting mirrors the core fields into an append-only MedicalRecord version via
the existing records service, so the patient history / timeline stay consistent.
"""
from django.db import transaction
from rest_framework.exceptions import ValidationError

from apps.appointments.services import complete_appointment
from apps.core.enums import AppointmentStatus
from apps.medical_records.services.records import create_record_version

from .models import Encounter, EncounterStatus

# Fields copied when an encounter is amended into a new editable twin.
_CLINICAL_FIELDS = (
    "patient", "doctor", "appointment", "encounter_date",
    "chief_complaint", "chief_complaint_ar", "symptoms",
    "examination_findings", "examination_findings_ar",
    "diagnosis", "diagnosis_notes",
    "treatment_plan", "treatment_plan_ar", "vitals",
)


def get_or_create_draft(*, appointment, doctor):
    """Return the encounter already attached to `appointment`, or create a DRAFT."""
    existing = Encounter.objects.filter(appointment=appointment).first()
    if existing:
        return existing
    return Encounter.objects.create(
        patient=appointment.patient,
        doctor=doctor,
        appointment=appointment,
        status=EncounterStatus.DRAFT,
    )


@transaction.atomic
def submit_encounter(encounter):
    """DRAFT -> SUBMITTED. Completes the appointment and mirrors a MedicalRecord."""
    if encounter.status != EncounterStatus.DRAFT:
        raise ValidationError({"status": "Only a draft encounter can be submitted."})

    encounter.status = EncounterStatus.SUBMITTED
    encounter.save(update_fields=["status", "updated_at"])

    appointment = encounter.appointment
    if appointment and appointment.status != AppointmentStatus.COMPLETED:
        complete_appointment(appointment)

    create_record_version(
        patient=encounter.patient,
        doctor=encounter.doctor,
        data={
            "chief_complaint": encounter.chief_complaint,
            "diagnosis": encounter.diagnosis.name if encounter.diagnosis else "",
            "diagnosis_ref": encounter.diagnosis,  # Phase 10: structured coded link
            "treatment_plan": encounter.treatment_plan,
            "appointment": appointment,
        },
    )
    return encounter


@transaction.atomic
def amend_encounter(encounter):
    """SUBMITTED -> mark original AMENDED/not-current; return editable DRAFT twin."""
    if encounter.status != EncounterStatus.SUBMITTED:
        raise ValidationError({"status": "Only a submitted encounter can be amended."})

    original = encounter
    twin = Encounter.objects.create(
        version=original.version + 1,
        is_current=True,
        status=EncounterStatus.DRAFT,
        supersedes=original,
        **{f: getattr(original, f) for f in _CLINICAL_FIELDS if f != "appointment"},
        # appointment is OneToOne — keep it on the original to avoid a unique clash.
    )

    original.is_current = False
    original.status = EncounterStatus.AMENDED
    original.save(update_fields=["is_current", "status", "updated_at"])
    return twin


# ---------------------------------------------------------------------------
# Phase 10 — diagnosis reference-data seeding (ICD-10)
# Shared by the seed_diagnoses management command and a RunPython data migration.
# ---------------------------------------------------------------------------

# (name, name_ar)
DIAGNOSIS_CATEGORIES = [
    ("Cardiovascular", "القلب والأوعية الدموية"),
    ("Endocrine", "الغدد الصماء"),
    ("Respiratory", "الجهاز التنفسي"),
    ("Infectious", "الأمراض المعدية"),
    ("Gastrointestinal", "الجهاز الهضمي"),
    ("Musculoskeletal", "العضلات والعظام"),
    ("Neurological", "الجهاز العصبي"),
    ("Mental Health", "الصحة النفسية"),
    ("Genitourinary", "الجهاز البولي التناسلي"),
    ("Dermatology", "الجلدية"),
    ("ENT & Ophthalmology", "الأنف والأذن والحنجرة والعيون"),
    ("General", "عام"),
]

# (name, name_ar, icd10_code, category_name, is_chronic)
DIAGNOSES = [
    ("Essential hypertension", "ارتفاع ضغط الدم الأساسي", "I10", "Cardiovascular", True),
    ("Hypertension", "ارتفاع ضغط الدم", "I10", "Cardiovascular", True),
    ("Atrial fibrillation", "الرجفان الأذيني", "I48", "Cardiovascular", True),
    ("Heart failure", "قصور القلب", "I50", "Cardiovascular", True),
    ("Ischemic heart disease", "مرض القلب الإقفاري", "I25", "Cardiovascular", True),
    ("Hyperlipidemia", "فرط شحميات الدم", "E78", "Cardiovascular", True),
    ("Type 2 diabetes mellitus", "السكري من النوع الثاني", "E11", "Endocrine", True),
    ("Type 1 diabetes mellitus", "السكري من النوع الأول", "E10", "Endocrine", True),
    ("Hypothyroidism", "قصور الغدة الدرقية", "E03", "Endocrine", True),
    ("Hyperthyroidism", "فرط نشاط الغدة الدرقية", "E05", "Endocrine", True),
    ("Obesity", "السمنة", "E66", "Endocrine", True),
    ("Vitamin D deficiency", "نقص فيتامين د", "E55", "Endocrine", False),
    ("Asthma", "الربو", "J45", "Respiratory", True),
    ("Chronic obstructive pulmonary disease", "الانسداد الرئوي المزمن", "J44", "Respiratory", True),
    ("Pneumonia", "التهاب رئوي", "J18", "Respiratory", False),
    ("Acute bronchitis", "التهاب الشعب الهوائية الحاد", "J20", "Respiratory", False),
    ("Acute upper respiratory infection", "عدوى الجهاز التنفسي العلوي الحادة", "J06", "Respiratory", False),
    ("Allergic rhinitis", "التهاب الأنف التحسسي", "J30", "Respiratory", True),
    ("Acute pharyngitis", "التهاب البلعوم الحاد", "J02", "Respiratory", False),
    ("Acute sinusitis", "التهاب الجيوب الأنفية الحاد", "J01", "Respiratory", False),
    ("Influenza", "الإنفلونزا", "J11", "Infectious", False),
    ("COVID-19", "كوفيد-19", "U07.1", "Infectious", False),
    ("Viral infection", "عدوى فيروسية", "B34", "Infectious", False),
    ("Urinary tract infection", "عدوى المسالك البولية", "N39.0", "Genitourinary", False),
    ("Gastroenteritis", "التهاب المعدة والأمعاء", "A09", "Gastrointestinal", False),
    ("Gastritis", "التهاب المعدة", "K29", "Gastrointestinal", False),
    ("Gastroesophageal reflux disease", "الارتجاع المعدي المريئي", "K21", "Gastrointestinal", True),
    ("Peptic ulcer disease", "القرحة الهضمية", "K27", "Gastrointestinal", False),
    ("Irritable bowel syndrome", "متلازمة القولون العصبي", "K58", "Gastrointestinal", True),
    ("Constipation", "الإمساك", "K59.0", "Gastrointestinal", False),
    ("Osteoarthritis", "الفصال العظمي", "M19", "Musculoskeletal", True),
    ("Rheumatoid arthritis", "التهاب المفاصل الروماتويدي", "M06", "Musculoskeletal", True),
    ("Lower back strain", "إجهاد أسفل الظهر", "M54.5", "Musculoskeletal", False),
    ("Low back pain", "ألم أسفل الظهر", "M54", "Musculoskeletal", True),
    ("Gout", "النقرس", "M10", "Musculoskeletal", True),
    ("Osteoporosis", "هشاشة العظام", "M81", "Musculoskeletal", True),
    ("Migraine", "الصداع النصفي", "G43", "Neurological", True),
    ("Tension headache", "صداع التوتر", "G44.2", "Neurological", False),
    ("Epilepsy", "الصرع", "G40", "Neurological", True),
    ("Peripheral neuropathy", "اعتلال الأعصاب الطرفية", "G62", "Neurological", True),
    ("Major depressive disorder", "اضطراب الاكتئاب الجسيم", "F32", "Mental Health", True),
    ("Generalized anxiety disorder", "اضطراب القلق العام", "F41.1", "Mental Health", True),
    ("Insomnia", "الأرق", "G47.0", "Mental Health", False),
    ("Anemia", "فقر الدم", "D64", "General", False),
    ("Iron deficiency anemia", "فقر الدم بعوز الحديد", "D50", "General", False),
    ("Chronic kidney disease", "مرض الكلى المزمن", "N18", "Genitourinary", True),
    ("Benign prostatic hyperplasia", "تضخم البروستاتا الحميد", "N40", "Genitourinary", True),
    ("Atopic dermatitis", "التهاب الجلد التأتبي", "L20", "Dermatology", True),
    ("Contact dermatitis", "التهاب الجلد التماسي", "L23", "Dermatology", False),
    ("Acne", "حب الشباب", "L70", "Dermatology", False),
    ("Conjunctivitis", "التهاب الملتحمة", "H10", "ENT & Ophthalmology", False),
    ("Acute otitis media", "التهاب الأذن الوسطى الحاد", "H66", "ENT & Ophthalmology", False),
]


def seed_diagnoses(apps=None):
    """Idempotently seed diagnosis categories + a curated ~50 ICD-10 diagnosis set.

    Matches existing rows by case-insensitive name (the Phase-8 seed already created
    a dozen) and fills in icd10_code / category_ref / is_chronic / name_ar instead of
    duplicating. When called from a migration, `apps` is the historical registry.
    """
    if apps is not None:
        DiagnosisModel = apps.get_model("encounters", "Diagnosis")
        CategoryModel = apps.get_model("encounters", "DiagnosisCategory")
    else:
        from .models import Diagnosis as DiagnosisModel, DiagnosisCategory as CategoryModel

    counts = {"categories": 0, "created": 0, "updated": 0}

    cat_map = {}
    for name, name_ar in DIAGNOSIS_CATEGORIES:
        obj, created = CategoryModel.objects.get_or_create(name=name, defaults={"name_ar": name_ar})
        cat_map[name] = obj
        counts["categories"] += int(created)

    for name, name_ar, icd10, cat_name, is_chronic in DIAGNOSES:
        category = cat_map.get(cat_name)
        existing = DiagnosisModel.objects.filter(name__iexact=name).first()
        if existing:
            existing.icd10_code = existing.icd10_code or icd10
            existing.category_ref = existing.category_ref or category
            existing.is_chronic = is_chronic
            if not existing.name_ar:
                existing.name_ar = name_ar
            existing.save(update_fields=["icd10_code", "category_ref", "is_chronic", "name_ar", "updated_at"])
            counts["updated"] += 1
        else:
            DiagnosisModel.objects.create(
                name=name, name_ar=name_ar, icd10_code=icd10,
                category_ref=category, is_chronic=is_chronic,
            )
            counts["created"] += 1

    return counts
