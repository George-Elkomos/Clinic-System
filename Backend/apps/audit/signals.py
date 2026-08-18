"""Generic audit receivers. Registered against a curated set of sensitive
models in apps.py:ready(). Old values are captured in pre_save by reloading the
row and diffing concrete fields."""
from django.apps import apps as django_apps
from django.db.models.signals import post_delete, post_save, pre_save

from apps.core.enums import AuditAction

from .services import record_event

# Phase-1 audited models (extend as later phases add sensitive models).
AUDITED_MODELS = [
    "users.User",
    "users.PatientProfile",
    "doctors.DoctorProfile",
    "doctors.WorkingSchedule",
    "doctors.DoctorAbsence",
    "appointments.Appointment",
    "medical_records.MedicalRecord",
    "medical_records.ClinicalNote",
    "medical_records.Prescription",
    "medical_records.Scan",
    "reviews.Review",
    "procedures.ClinicalProcedure",
    "radiology.RadiologyOrder",
]

# cancelled_at/cancelled_by are excluded too: they're redundant with what an
# audit row already carries for free (its own timestamp = when, its own actor
# = who), and cancelled_by only ever diffs to a raw FK id, not a name.
IGNORED_FIELDS = {
    "created_at", "updated_at", "last_login", "password",
    "cancelled_at", "cancelled_by",
}


def _serialize(value):
    # Lists/dicts (e.g. ClinicalProcedure.checklist_state) are already JSON-native
    # -- pass them through as-is so the frontend gets real structured data to
    # render, instead of Python's str() repr (single-quoted, capitalized
    # True/False) collapsed into one unreadable string.
    if value is None or isinstance(value, (str, int, float, bool, list, dict)):
        return value
    return str(value)


def _compute_changes(old, new):
    changes = {}
    for field in new._meta.concrete_fields:
        if field.name in IGNORED_FIELDS:
            continue
        attr = field.attname  # FK -> "<field>_id"
        old_v = getattr(old, attr, None)
        new_v = getattr(new, attr, None)
        if old_v != new_v:
            changes[field.name] = {"old": _serialize(old_v), "new": _serialize(new_v)}
    return changes


def audit_pre_save(sender, instance, **kwargs):
    if not instance.pk:
        instance._audit_changes = None
        return
    old = sender._base_manager.filter(pk=instance.pk).first()
    instance._audit_changes = _compute_changes(old, instance) if old else None


def audit_post_save(sender, instance, created, **kwargs):
    if created:
        record_event(action=AuditAction.CREATE, instance=instance)
    else:
        changes = getattr(instance, "_audit_changes", None)
        # Skip no-op saves (e.g. update_fields that changed nothing tracked).
        if changes:
            record_event(action=AuditAction.UPDATE, instance=instance, changes=changes)


def audit_post_delete(sender, instance, **kwargs):
    record_event(action=AuditAction.DELETE, instance=instance)


def register_audit_signals():
    for label in AUDITED_MODELS:
        app_label, model_name = label.split(".")
        model = django_apps.get_model(app_label, model_name)
        uid = f"audit_{label}"
        pre_save.connect(audit_pre_save, sender=model, dispatch_uid=uid + "_pre")
        post_save.connect(audit_post_save, sender=model, dispatch_uid=uid + "_post")
        post_delete.connect(audit_post_delete, sender=model, dispatch_uid=uid + "_del")
