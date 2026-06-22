"""The shape of the structured clinical draft the LLM produces and the doctor
reviews. Kept in one place so extraction, the serializer, and the commit step
agree on field names. Field names mirror the MedicalRecord / PrescriptionItem
models so committing is a near-direct mapping."""

# Keys allowed inside the `vitals` object (mirrors MedicalRecord.vitals JSON).
VITALS_KEYS = (
    "blood_pressure",
    "heart_rate",
    "temperature",
    "respiratory_rate",
    "oxygen_saturation",
    "weight",
    "height",
    "notes",
)

# Keys allowed inside each prescription item (mirrors PrescriptionItem fields).
PRESCRIPTION_ITEM_KEYS = (
    "drug_name",
    "dosage",
    "frequency",
    "duration",
    "instructions",
)


def empty_draft():
    """A fully-formed empty draft, so the frontend can rely on every key existing."""
    return {
        "chief_complaint": "",
        "diagnosis": "",
        "treatment_plan": "",
        "clinical_summary": "",
        "follow_up": "",
        "vitals": {k: "" for k in VITALS_KEYS},
        "prescriptions": [],
    }


def normalize_draft(raw):
    """Coerce arbitrary LLM/JSON output into the canonical draft shape.

    Drops unknown keys, fills missing ones, and guarantees types so neither the
    UI nor the commit step has to defend against a malformed object.
    """
    draft = empty_draft()
    if not isinstance(raw, dict):
        return draft

    for key in ("chief_complaint", "diagnosis", "treatment_plan", "clinical_summary", "follow_up"):
        val = raw.get(key)
        if isinstance(val, str):
            draft[key] = val.strip()

    vitals = raw.get("vitals")
    if isinstance(vitals, dict):
        for k in VITALS_KEYS:
            v = vitals.get(k)
            if v is not None:
                draft["vitals"][k] = str(v).strip()

    items = raw.get("prescriptions")
    if isinstance(items, list):
        clean = []
        for it in items:
            if not isinstance(it, dict):
                continue
            row = {k: str(it.get(k, "") or "").strip() for k in PRESCRIPTION_ITEM_KEYS}
            if row["drug_name"]:  # a med with no name is noise
                clean.append(row)
        draft["prescriptions"] = clean

    return draft
