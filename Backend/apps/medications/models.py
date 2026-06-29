"""Medication master + drug-allergy alert reference data (Phase 9).

Structured reference data that replaces free-text drug names in prescriptions.
All lookups mirror the Phase 8 `encounters.Complaint`/`Diagnosis` shape: bilingual
`name`/`name_ar`, an `is_active` flag, and `Meta.ordering = ["name"]`.

`AllergyAlert` is a GLOBAL rule table (not patient-specific): "if a patient's
free-text allergies mention <keyword>, prescribing anything in <drug_class> raises
an alert of <severity>". The per-patient signal is the free-text
`PatientProfile.allergies_summary`, matched at prescription time in services.py.
"""
from django.db import models

from apps.core.enums import AllergySeverity
from apps.core.models import TimeStampedModel


class MedicationClass(TimeStampedModel):
    """Therapeutic class, e.g. "Beta-Lactam Antibiotics"."""

    name = models.CharField(max_length=200)
    name_ar = models.CharField(max_length=200, blank=True)
    # Reserved for future drug-drug interaction work; not exercised by the
    # allergy-check endpoint in this phase.
    interactions = models.ManyToManyField("self", symmetrical=True, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class DosageForm(TimeStampedModel):
    """Physical form of a medication, e.g. Tablet, Capsule, Syrup."""

    name = models.CharField(max_length=100)
    name_ar = models.CharField(max_length=100, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class DosagePattern(TimeStampedModel):
    """How often a medication is taken, e.g. "Twice Daily" (BID)."""

    name = models.CharField(max_length=100)
    name_ar = models.CharField(max_length=100, blank=True)
    code = models.CharField(max_length=10, blank=True)  # OD, BID, TID, QID, PRN
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class Medication(TimeStampedModel):
    """Master drug record feeding the prescription typeahead."""

    name = models.CharField(max_length=200)  # generic name
    name_ar = models.CharField(max_length=200, blank=True)
    brand_names = models.JSONField(default=list, blank=True)
    drug_class = models.ForeignKey(
        MedicationClass, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="medications",
    )
    dosage_forms = models.ManyToManyField(DosageForm, blank=True)
    requires_prescription = models.BooleanField(default=True)
    notes = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class AllergyAlert(TimeStampedModel):
    """Global rule: a documented allergy keyword that conflicts with a drug class."""

    allergy_keyword = models.CharField(max_length=100)  # e.g. "penicillin"
    drug_class = models.ForeignKey(
        MedicationClass, on_delete=models.CASCADE, related_name="allergy_alerts"
    )
    severity = models.CharField(max_length=20, choices=AllergySeverity.choices)
    message = models.TextField()
    message_ar = models.TextField(blank=True)

    class Meta:
        ordering = ["allergy_keyword"]

    def __str__(self):
        return f"{self.allergy_keyword} → {self.drug_class} ({self.severity})"
