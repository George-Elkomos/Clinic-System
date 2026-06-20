"""CW-7: Keep MedicalRecord.vitals in sync with the typed VitalSigns model.

When a VitalSigns record is saved and has an appointment FK, the corresponding
current MedicalRecord for that appointment is updated with a structured snapshot.
This preserves backward-compatibility for any code that reads MedicalRecord.vitals
while the legacy JSONField is being phased out.
"""
from django.db.models.signals import post_save
from django.dispatch import receiver


@receiver(post_save, sender="vital_signs.VitalSigns")
def sync_vitals_to_medical_record(sender, instance, **kwargs):
    if not instance.appointment_id:
        return

    # Import inside the handler to avoid circular imports at module load time.
    from apps.medical_records.models import MedicalRecord

    record = (
        MedicalRecord.objects
        .filter(appointment_id=instance.appointment_id, is_current=True)
        .first()
    )
    if record is None:
        return

    snapshot = {
        "bp_systolic": instance.bp_systolic,
        "bp_diastolic": instance.bp_diastolic,
        "heart_rate": instance.heart_rate,
        "temperature": str(instance.temperature),
        "respiratory_rate": instance.respiratory_rate,
        "oxygen_saturation": instance.oxygen_saturation,
        "weight": str(instance.weight),
        "height": instance.height,
        "bmi": instance.bmi,
    }
    if instance.blood_glucose is not None:
        snapshot["blood_glucose"] = instance.blood_glucose

    record.vitals = snapshot
    record.save(update_fields=["vitals"])
