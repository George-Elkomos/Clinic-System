"""Patient history timeline.

Merges events from six clinical sources (vitals, lab orders, prescriptions,
clinical notes, medical records, completed appointments) into one chronological
feed. Each event is a plain dict with a common shape so the API can paginate the
combined list and the frontend can render + expand it without extra fetches.
"""
from apps.core.enums import AppointmentStatus

# Canonical event-type identifiers (kept in sync with the frontend union type).
VITAL_SIGNS = "VITAL_SIGNS"
LAB_ORDER = "LAB_ORDER"
PRESCRIPTION = "PRESCRIPTION"
CLINICAL_NOTE = "CLINICAL_NOTE"
MEDICAL_RECORD = "MEDICAL_RECORD"
APPOINTMENT_COMPLETED = "APPOINTMENT_COMPLETED"

ALL_EVENT_TYPES = {
    VITAL_SIGNS,
    LAB_ORDER,
    PRESCRIPTION,
    CLINICAL_NOTE,
    MEDICAL_RECORD,
    APPOINTMENT_COMPLETED,
}


def _iso(dt):
    return dt.isoformat() if dt else None


def _snippet(text, length=120):
    text = (text or "").strip()
    if len(text) <= length:
        return text
    return text[:length].rstrip() + "…"


def _event(obj_id, event_type, event_date, title, summary, detail):
    """Assemble one timeline event. `id` is a stable composite of type + pk."""
    return {
        "id": f"{event_type}:{obj_id}",
        "event_type": event_type,
        "event_date": _iso(event_date),
        "title": title,
        "summary": summary,
        "detail": detail,
    }


def _vital_events(patient):
    events = []
    for v in patient.vital_signs.all():
        summary = (
            f"BP: {v.bp_systolic}/{v.bp_diastolic} mmHg · "
            f"HR: {v.heart_rate} bpm · Temp: {v.temperature}°C"
        )
        events.append(_event(
            v.id, VITAL_SIGNS, v.created_at, "Vital signs recorded", summary,
            {
                "bp_systolic": v.bp_systolic,
                "bp_diastolic": v.bp_diastolic,
                "heart_rate": v.heart_rate,
                "temperature": str(v.temperature),
                "respiratory_rate": v.respiratory_rate,
                "oxygen_saturation": v.oxygen_saturation,
                "weight": str(v.weight),
                "height": v.height,
                "bmi": v.bmi,
                "blood_glucose": v.blood_glucose,
                "notes": v.notes,
            },
        ))
    return events


def _lab_order_events(patient):
    events = []
    for o in patient.lab_orders.all():
        summary = f"Order #{o.order_number} ({o.priority}) · Status: {o.status}"
        events.append(_event(
            o.id, LAB_ORDER, o.created_at, "Lab order", summary,
            {
                "order_number": o.order_number,
                "priority": o.priority,
                "status": o.status,
                "clinical_notes": o.clinical_notes,
                "tests": [item.test_name for item in o.items.all()],
            },
        ))
    return events


def _prescription_events(patient):
    events = []
    for p in patient.prescriptions.all():
        items = list(p.items.all())
        summary = f"{len(items)} items prescribed"
        events.append(_event(
            p.id, PRESCRIPTION, p.created_at, "Prescription", summary,
            {
                "status": p.status,
                "notes": p.notes,
                "items": [
                    {
                        "drug_name": it.drug_name,
                        "dosage": it.dosage,
                        "frequency": it.frequency,
                        "duration": it.duration,
                    }
                    for it in items
                ],
            },
        ))
    return events


def _clinical_note_events(patient):
    events = []
    for n in patient.clinical_notes.all():
        events.append(_event(
            n.id, CLINICAL_NOTE, n.created_at, "Clinical note", _snippet(n.body),
            {
                "specialty_category": getattr(n.specialty_category, "name", ""),
                "body": n.body,
                "body_ar": n.body_ar,
            },
        ))
    return events


def _medical_record_events(patient):
    events = []
    for r in patient.medical_records.filter(is_current=True):
        summary = _snippet(r.diagnosis) or _snippet(r.chief_complaint) or "Medical record"
        events.append(_event(
            r.id, MEDICAL_RECORD, r.created_at, f"Medical record (v{r.version})", summary,
            {
                "version": r.version,
                "chief_complaint": r.chief_complaint,
                "diagnosis": r.diagnosis,
                "treatment_plan": r.treatment_plan,
            },
        ))
    return events


def _appointment_events(patient):
    events = []
    qs = patient.appointments.filter(
        status=AppointmentStatus.COMPLETED
    ).select_related("doctor__user")
    for a in qs:
        doctor_name = a.doctor.user.get_full_name() if a.doctor and a.doctor.user else "—"
        events.append(_event(
            a.id, APPOINTMENT_COMPLETED,
            a.completed_at or a.scheduled_start,
            "Completed appointment",
            f"Completed consultation with Dr. {doctor_name}",
            {
                "doctor_name": doctor_name,
                "reason": a.reason,
                "scheduled_start": _iso(a.scheduled_start),
                "completed_at": _iso(a.completed_at),
            },
        ))
    return events


_BUILDERS = {
    VITAL_SIGNS: _vital_events,
    LAB_ORDER: _lab_order_events,
    PRESCRIPTION: _prescription_events,
    CLINICAL_NOTE: _clinical_note_events,
    MEDICAL_RECORD: _medical_record_events,
    APPOINTMENT_COMPLETED: _appointment_events,
}


def build_patient_timeline(patient, types=None, date_from=None, date_to=None):
    """Return a list of timeline event dicts for `patient`, newest first.

    `types`     — optional iterable of event-type strings to include.
    `date_from` — optional ISO date string (YYYY-MM-DD); keeps events on/after it.
    `date_to`   — optional ISO date string; keeps events on/before it (inclusive).
    """
    wanted = ALL_EVENT_TYPES if not types else (set(types) & ALL_EVENT_TYPES)

    events = []
    for event_type in wanted:
        events.extend(_BUILDERS[event_type](patient))

    if date_from:
        events = [e for e in events if e["event_date"] and e["event_date"][:10] >= date_from]
    if date_to:
        events = [e for e in events if e["event_date"] and e["event_date"][:10] <= date_to]

    # Sort newest first; events without a date sink to the bottom.
    events.sort(key=lambda e: e["event_date"] or "", reverse=True)
    return events
