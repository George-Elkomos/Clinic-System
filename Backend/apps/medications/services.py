"""Medication services: drug-allergy interaction checking + reference-data seeding.

The seed routine lives here so both the `seed_medications` management command and
the `0002_seed_reference_data` data migration call the exact same idempotent logic.
"""


def check_allergy_interactions(patient, medication_ids):
    """Return a list of allergy-alert warning dicts for the given medications.

    Matches the patient's free-text `allergies_summary` (case-insensitive substring)
    against `AllergyAlert.allergy_keyword` for each medication's drug class.
    """
    from .models import AllergyAlert, Medication

    allergy_text = (getattr(patient, "allergies_summary", "") or "").lower()
    if not allergy_text or not medication_ids:
        return []

    medications = (
        Medication.objects.select_related("drug_class")
        .filter(id__in=medication_ids, drug_class__isnull=False)
    )

    warnings = []
    for med in medications:
        alerts = AllergyAlert.objects.select_related("drug_class").filter(drug_class=med.drug_class)
        for alert in alerts:
            if alert.allergy_keyword.lower() in allergy_text:
                warnings.append({
                    "medication_id": med.id,
                    "medication_name": med.name,
                    "allergy_keyword": alert.allergy_keyword,
                    "drug_class": med.drug_class.name,
                    "severity": alert.severity,
                    "message": alert.message,
                    "message_ar": alert.message_ar,
                })
    return warnings


# ---------------------------------------------------------------------------
# Reference-data seeding (shared by the management command + data migration)
# ---------------------------------------------------------------------------

DOSAGE_FORMS = [
    ("Tablet", "قرص"),
    ("Capsule", "كبسولة"),
    ("Syrup", "شراب"),
    ("Injection", "حقنة"),
    ("Cream", "كريم"),
    ("Drops", "قطرات"),
    ("Inhaler", "بخاخ"),
    ("Patch", "لصقة"),
    ("Suppository", "تحميلة"),
]

DOSAGE_PATTERNS = [
    ("Once Daily", "مرة واحدة يومياً", "OD"),
    ("Twice Daily", "مرتين يومياً", "BID"),
    ("Three Times Daily", "ثلاث مرات يومياً", "TID"),
    ("Four Times Daily", "أربع مرات يومياً", "QID"),
    ("As Needed", "عند الحاجة", "PRN"),
]

# (name, name_ar) — therapeutic classes.
MEDICATION_CLASSES = [
    ("Beta-Lactam Antibiotics", "مضادات حيوية بيتا لاكتام"),
    ("Macrolide Antibiotics", "مضادات حيوية ماكروليد"),
    ("Fluoroquinolone Antibiotics", "مضادات حيوية فلوروكينولون"),
    ("Sulfonamide Antibiotics", "مضادات حيوية سلفوناميد"),
    ("NSAIDs", "مضادات الالتهاب غير الستيرويدية"),
    ("Opioid Analgesics", "مسكنات أفيونية"),
    ("Antipyretics", "خافضات الحرارة"),
    ("ACE Inhibitors", "مثبطات الإنزيم المحول للأنجيوتنسين"),
    ("Beta Blockers", "حاصرات بيتا"),
    ("Calcium Channel Blockers", "حاصرات قنوات الكالسيوم"),
    ("Statins", "ستاتينات"),
    ("Proton Pump Inhibitors", "مثبطات مضخة البروتون"),
    ("Antihistamines", "مضادات الهيستامين"),
    ("Corticosteroids", "الكورتيكوستيرويدات"),
    ("Bronchodilators", "موسعات الشعب الهوائية"),
    ("Antidiabetics", "أدوية السكري"),
    ("Anticoagulants", "مضادات التخثر"),
    ("SSRIs", "مثبطات استرداد السيروتونين الانتقائية"),
    ("Thyroid Hormones", "هرمونات الغدة الدرقية"),
    ("Antiemetics", "مضادات القيء"),
]

# (name, name_ar, class_name, [brand_names]) — curated ~50 common medications.
MEDICATIONS = [
    ("Amoxicillin", "أموكسيسيلين", "Beta-Lactam Antibiotics", ["Amoxil", "Moxatag"]),
    ("Ampicillin", "أمبيسيلين", "Beta-Lactam Antibiotics", ["Principen"]),
    ("Penicillin V", "بنسلين V", "Beta-Lactam Antibiotics", ["Penicillin VK"]),
    ("Amoxicillin/Clavulanate", "أموكسيسيلين/كلافولانات", "Beta-Lactam Antibiotics", ["Augmentin"]),
    ("Cephalexin", "سيفالكسين", "Beta-Lactam Antibiotics", ["Keflex"]),
    ("Ceftriaxone", "سيفترياكسون", "Beta-Lactam Antibiotics", ["Rocephin"]),
    ("Azithromycin", "أزيثروميسين", "Macrolide Antibiotics", ["Zithromax", "Z-Pak"]),
    ("Clarithromycin", "كلاريثروميسين", "Macrolide Antibiotics", ["Biaxin"]),
    ("Erythromycin", "إريثروميسين", "Macrolide Antibiotics", ["Ery-Tab"]),
    ("Ciprofloxacin", "سيبروفلوكساسين", "Fluoroquinolone Antibiotics", ["Cipro"]),
    ("Levofloxacin", "ليفوفلوكساسين", "Fluoroquinolone Antibiotics", ["Levaquin"]),
    ("Trimethoprim/Sulfamethoxazole", "تريميثوبريم/سلفاميثوكسازول", "Sulfonamide Antibiotics", ["Bactrim", "Septra"]),
    ("Ibuprofen", "إيبوبروفين", "NSAIDs", ["Advil", "Motrin"]),
    ("Naproxen", "نابروكسين", "NSAIDs", ["Aleve", "Naprosyn"]),
    ("Diclofenac", "ديكلوفيناك", "NSAIDs", ["Voltaren"]),
    ("Aspirin", "أسبرين", "NSAIDs", ["Bayer", "Ecotrin"]),
    ("Celecoxib", "سيليكوكسيب", "NSAIDs", ["Celebrex"]),
    ("Morphine", "مورفين", "Opioid Analgesics", ["MS Contin"]),
    ("Tramadol", "ترامادول", "Opioid Analgesics", ["Ultram"]),
    ("Codeine", "كودايين", "Opioid Analgesics", []),
    ("Paracetamol", "باراسيتامول", "Antipyretics", ["Panadol", "Tylenol"]),
    ("Lisinopril", "ليزينوبريل", "ACE Inhibitors", ["Prinivil", "Zestril"]),
    ("Enalapril", "إينالابريل", "ACE Inhibitors", ["Vasotec"]),
    ("Ramipril", "راميبريل", "ACE Inhibitors", ["Altace"]),
    ("Atenolol", "أتينولول", "Beta Blockers", ["Tenormin"]),
    ("Metoprolol", "ميتوبرولول", "Beta Blockers", ["Lopressor", "Toprol"]),
    ("Propranolol", "بروبرانولول", "Beta Blockers", ["Inderal"]),
    ("Amlodipine", "أملوديبين", "Calcium Channel Blockers", ["Norvasc"]),
    ("Diltiazem", "ديلتيازيم", "Calcium Channel Blockers", ["Cardizem"]),
    ("Atorvastatin", "أتورفاستاتين", "Statins", ["Lipitor"]),
    ("Simvastatin", "سيمفاستاتين", "Statins", ["Zocor"]),
    ("Rosuvastatin", "روزوفاستاتين", "Statins", ["Crestor"]),
    ("Omeprazole", "أوميبرازول", "Proton Pump Inhibitors", ["Prilosec"]),
    ("Esomeprazole", "إيزوميبرازول", "Proton Pump Inhibitors", ["Nexium"]),
    ("Pantoprazole", "بانتوبرازول", "Proton Pump Inhibitors", ["Protonix"]),
    ("Loratadine", "لوراتادين", "Antihistamines", ["Claritin"]),
    ("Cetirizine", "سيتيريزين", "Antihistamines", ["Zyrtec"]),
    ("Diphenhydramine", "ديفينهيدرامين", "Antihistamines", ["Benadryl"]),
    ("Prednisone", "بريدنيزون", "Corticosteroids", ["Deltasone"]),
    ("Prednisolone", "بريدنيزولون", "Corticosteroids", ["Prelone"]),
    ("Hydrocortisone", "هيدروكورتيزون", "Corticosteroids", ["Cortef"]),
    ("Salbutamol", "سالبوتامول", "Bronchodilators", ["Ventolin", "Albuterol"]),
    ("Ipratropium", "إبراتروبيوم", "Bronchodilators", ["Atrovent"]),
    ("Metformin", "ميتفورمين", "Antidiabetics", ["Glucophage"]),
    ("Glibenclamide", "غليبنكلاميد", "Antidiabetics", ["Daonil"]),
    ("Insulin Glargine", "إنسولين غلارجين", "Antidiabetics", ["Lantus"]),
    ("Warfarin", "وارفارين", "Anticoagulants", ["Coumadin"]),
    ("Rivaroxaban", "ريفاروكسابان", "Anticoagulants", ["Xarelto"]),
    ("Sertraline", "سيرترالين", "SSRIs", ["Zoloft"]),
    ("Fluoxetine", "فلوكسيتين", "SSRIs", ["Prozac"]),
    ("Escitalopram", "إيسيتالوبرام", "SSRIs", ["Lexapro"]),
    ("Levothyroxine", "ليفوثيروكسين", "Thyroid Hormones", ["Synthroid"]),
    ("Ondansetron", "أوندانسيترون", "Antiemetics", ["Zofran"]),
    ("Metoclopramide", "ميتوكلوبراميد", "Antiemetics", ["Reglan"]),
]

# (allergy_keyword, class_name, severity, message, message_ar)
ALLERGY_ALERTS = [
    ("penicillin", "Beta-Lactam Antibiotics", "SEVERE",
     "Patient has a documented penicillin allergy. Beta-lactam antibiotics may cause a serious cross-reaction.",
     "المريض لديه حساسية موثقة من البنسلين. قد تسبب مضادات بيتا لاكتام تفاعلاً تحسسياً خطيراً."),
    ("amoxicillin", "Beta-Lactam Antibiotics", "SEVERE",
     "Patient has a documented amoxicillin allergy. Avoid beta-lactam antibiotics.",
     "المريض لديه حساسية موثقة من الأموكسيسيلين. تجنب مضادات بيتا لاكتام."),
    ("sulfa", "Sulfonamide Antibiotics", "SEVERE",
     "Patient has a documented sulfa allergy. Sulfonamide antibiotics are contraindicated.",
     "المريض لديه حساسية موثقة من السلفا. مضادات السلفوناميد ممنوعة."),
    ("aspirin", "NSAIDs", "MODERATE",
     "Patient has a documented aspirin/NSAID sensitivity. Use NSAIDs with caution.",
     "المريض لديه حساسية موثقة من الأسبرين/مضادات الالتهاب. استخدم بحذر."),
    ("ibuprofen", "NSAIDs", "MODERATE",
     "Patient has a documented ibuprofen/NSAID sensitivity. Use NSAIDs with caution.",
     "المريض لديه حساسية موثقة من الإيبوبروفين/مضادات الالتهاب. استخدم بحذر."),
    ("codeine", "Opioid Analgesics", "MODERATE",
     "Patient has a documented codeine/opioid sensitivity. Use opioid analgesics with caution.",
     "المريض لديه حساسية موثقة من الكودايين/المواد الأفيونية. استخدم بحذر."),
    ("penicillin", "Macrolide Antibiotics", "MILD",
     "Patient reports a penicillin allergy; macrolides are generally a safe alternative but monitor.",
     "المريض يبلغ عن حساسية من البنسلين؛ الماكروليدات بديل آمن عموماً لكن يجب المراقبة."),
]


def seed_reference_data(apps=None):
    """Idempotently seed dosage forms, patterns, classes, medications, allergy alerts.

    When called from a migration, `apps` is the historical app registry; otherwise
    the live models are used (management command).
    """
    if apps is not None:
        MedicationClass = apps.get_model("medications", "MedicationClass")
        DosageForm = apps.get_model("medications", "DosageForm")
        DosagePattern = apps.get_model("medications", "DosagePattern")
        Medication = apps.get_model("medications", "Medication")
        AllergyAlert = apps.get_model("medications", "AllergyAlert")
    else:
        from .models import (
            AllergyAlert, DosageForm, DosagePattern, Medication, MedicationClass,
        )

    counts = {"forms": 0, "patterns": 0, "classes": 0, "medications": 0, "alerts": 0}

    for name, name_ar in DOSAGE_FORMS:
        _, created = DosageForm.objects.get_or_create(name=name, defaults={"name_ar": name_ar})
        counts["forms"] += int(created)

    for name, name_ar, code in DOSAGE_PATTERNS:
        _, created = DosagePattern.objects.get_or_create(
            name=name, defaults={"name_ar": name_ar, "code": code}
        )
        counts["patterns"] += int(created)

    class_map = {}
    for name, name_ar in MEDICATION_CLASSES:
        obj, created = MedicationClass.objects.get_or_create(name=name, defaults={"name_ar": name_ar})
        class_map[name] = obj
        counts["classes"] += int(created)

    for name, name_ar, class_name, brands in MEDICATIONS:
        _, created = Medication.objects.get_or_create(
            name=name,
            defaults={
                "name_ar": name_ar,
                "drug_class": class_map.get(class_name),
                "brand_names": brands,
            },
        )
        counts["medications"] += int(created)

    for keyword, class_name, severity, message, message_ar in ALLERGY_ALERTS:
        drug_class = class_map.get(class_name)
        if drug_class is None:
            continue
        _, created = AllergyAlert.objects.get_or_create(
            allergy_keyword=keyword, drug_class=drug_class,
            defaults={"severity": severity, "message": message, "message_ar": message_ar},
        )
        counts["alerts"] += int(created)

    return counts
