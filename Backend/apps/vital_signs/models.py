"""Vital Signs — first-class model for structured clinical measurements.

Recorded by staff (Doctor, Secretary, Manager) before or during a consultation.
Patients can read their own records but cannot create or modify them.
"""
from decimal import Decimal

from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from apps.core.models import SoftDeleteModel, TimeStampedModel


class VitalSigns(SoftDeleteModel, TimeStampedModel):
    """One set of vital sign measurements per recording session."""

    patient = models.ForeignKey(
        "users.PatientProfile",
        on_delete=models.CASCADE,
        related_name="vital_signs",
    )
    recorded_by = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="recorded_vitals",
    )
    appointment = models.ForeignKey(
        "appointments.Appointment",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="vital_signs",
    )

    # Blood Pressure (mmHg)
    bp_systolic = models.PositiveSmallIntegerField(
        validators=[MinValueValidator(60), MaxValueValidator(250)],
    )
    bp_diastolic = models.PositiveSmallIntegerField(
        validators=[MinValueValidator(30), MaxValueValidator(150)],
    )

    # Heart Rate (bpm)
    heart_rate = models.PositiveSmallIntegerField(
        validators=[MinValueValidator(20), MaxValueValidator(300)],
    )

    # Temperature (°C)
    temperature = models.DecimalField(
        max_digits=4,
        decimal_places=1,
        validators=[MinValueValidator(Decimal("30.0")), MaxValueValidator(Decimal("45.0"))],
    )

    # Respiratory Rate (breaths/min)
    respiratory_rate = models.PositiveSmallIntegerField(
        validators=[MinValueValidator(5), MaxValueValidator(60)],
    )

    # Oxygen Saturation (%)
    oxygen_saturation = models.PositiveSmallIntegerField(
        validators=[MinValueValidator(70), MaxValueValidator(100)],
    )

    # Weight (kg)
    weight = models.DecimalField(
        max_digits=5,
        decimal_places=1,
        validators=[MinValueValidator(Decimal("0.5")), MaxValueValidator(Decimal("500.0"))],
    )

    # Height (cm)
    height = models.PositiveSmallIntegerField(
        validators=[MinValueValidator(20), MaxValueValidator(300)],
    )

    # Blood Glucose (mg/dL) — optional
    blood_glucose = models.PositiveSmallIntegerField(
        null=True,
        blank=True,
        validators=[MinValueValidator(20), MaxValueValidator(600)],
    )

    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["patient", "-created_at"]),
            models.Index(fields=["appointment"]),
        ]

    def __str__(self):
        return f"Vitals for {self.patient} @ {self.created_at:%Y-%m-%d %H:%M}"

    @property
    def bmi(self):
        """Body Mass Index: weight(kg) / height(m)². Returns None if missing."""
        if self.height and self.weight:
            h_m = float(self.height) / 100
            return round(float(self.weight) / (h_m ** 2), 1)
        return None
