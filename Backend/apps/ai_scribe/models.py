"""AI Scribe data model.

A SessionRecording is the lifecycle of one recorded consultation:

    upload audio -> TRANSCRIBING -> EXTRACTING -> READY (a draft the doctor
    reviews) -> COMMITTED (doctor confirmed; clinical rows were written).

Nothing is written to the clinical tables (MedicalRecord / Prescription)
automatically — the LLM only fills `extracted` (a draft). A doctor must call the
commit endpoint to turn that draft into real, versioned records. This keeps a
human in the loop for anything an LLM might hallucinate (diagnoses, dosages).

Soft-deletable + timestamped to match the rest of the clinical schema.
"""
from pathlib import Path
from uuid import uuid4

from django.db import models

from apps.core.models import SoftDeleteModel, TimeStampedModel
from apps.doctors.models import DoctorProfile
from apps.users.models import PatientProfile


def session_audio_path(instance, filename):
    ext = Path(filename).suffix.lower() or ".webm"
    return f"ai_sessions/patient_{instance.patient_id}/{uuid4().hex}{ext}"


class SessionStatus(models.TextChoices):
    PENDING = "PENDING", "Pending"          # uploaded, queued for processing
    TRANSCRIBING = "TRANSCRIBING", "Transcribing"  # Whisper running
    EXTRACTING = "EXTRACTING", "Extracting"        # LLM structuring the transcript
    READY = "READY", "Ready for review"     # draft available; awaiting doctor
    FAILED = "FAILED", "Failed"             # see `error`
    COMMITTED = "COMMITTED", "Committed"    # doctor confirmed; records written


class SessionRecording(SoftDeleteModel, TimeStampedModel):
    patient = models.ForeignKey(
        PatientProfile, on_delete=models.CASCADE, related_name="ai_sessions"
    )
    doctor = models.ForeignKey(
        DoctorProfile, on_delete=models.SET_NULL, null=True, related_name="ai_sessions"
    )
    appointment = models.ForeignKey(
        "appointments.Appointment", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="ai_sessions",
    )

    audio = models.FileField(upload_to=session_audio_path)
    original_filename = models.CharField(max_length=255, blank=True)
    content_type = models.CharField(max_length=100, blank=True)
    file_size = models.PositiveIntegerField(default=0)
    language = models.CharField(max_length=8, blank=True)  # "" => auto-detect

    status = models.CharField(
        max_length=16, choices=SessionStatus.choices, default=SessionStatus.PENDING,
        db_index=True,
    )
    error = models.TextField(blank=True)

    transcript = models.TextField(blank=True)
    # [{"start": float, "end": float, "text": str}, ...]
    segments = models.JSONField(default=list, blank=True)
    # The structured clinical draft the doctor reviews (see services/extraction.py).
    extracted = models.JSONField(default=dict, blank=True)

    # Set once the doctor commits the draft into real clinical rows.
    committed_record = models.ForeignKey(
        "medical_records.MedicalRecord", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="ai_sessions",
    )
    committed_prescription = models.ForeignKey(
        "medical_records.Prescription", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="ai_sessions",
    )

    processing_started_at = models.DateTimeField(null=True, blank=True)
    processing_finished_at = models.DateTimeField(null=True, blank=True)
    committed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["patient", "status"]),
            models.Index(fields=["doctor", "status"]),
        ]

    def __str__(self):
        return f"AI session #{self.pk} for {self.patient} ({self.status})"
