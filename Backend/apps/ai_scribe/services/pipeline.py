"""Background processing for a SessionRecording.

Transcription + LLM extraction take seconds-to-minutes, so they must NOT run
inside the HTTP request. `process_in_background` hands `run_pipeline` off to
the Django-Q worker queue (see Q_CLUSTER in settings/base.py — ORM-backed, no
Redis) and the frontend polls the session's `status`.
"""
import logging

from django.utils import timezone
from django_q.tasks import async_task

from ..models import SessionRecording, SessionStatus
from . import extraction, transcription

logger = logging.getLogger(__name__)


def _set(session, **fields):
    for k, v in fields.items():
        setattr(session, k, v)
    session.save(update_fields=list(fields) + ["updated_at"])


def run_pipeline(session_id):
    """Transcribe then extract for one session. Safe to call from any thread."""
    try:
        session = SessionRecording.objects.get(pk=session_id)
    except SessionRecording.DoesNotExist:
        logger.warning("AI pipeline: session %s vanished before processing", session_id)
        return

    try:
        _set(session, status=SessionStatus.TRANSCRIBING,
             processing_started_at=timezone.now(), error="")
        text, segments = transcription.transcribe(session.audio.path, session.language or None)
        _set(session, transcript=text, segments=segments)

        _set(session, status=SessionStatus.EXTRACTING)
        draft = extraction.extract(text)
        _set(session, extracted=draft, status=SessionStatus.READY,
             processing_finished_at=timezone.now())
        logger.info("AI pipeline: session %s ready", session_id)
    except Exception as exc:  # noqa: BLE001 - surface any failure to the doctor
        logger.exception("AI pipeline failed for session %s", session_id)
        _set(session, status=SessionStatus.FAILED, error=str(exc),
             processing_finished_at=timezone.now())


def process_in_background(session_id):
    """Queue processing on the Django-Q worker and return immediately."""
    async_task(run_pipeline, session_id)
