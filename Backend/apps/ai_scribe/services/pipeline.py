"""Background processing for a SessionRecording.

Transcription + LLM extraction take seconds-to-minutes, so they must NOT run
inside the HTTP request. We run them on a daemon thread and the frontend polls
the session's `status`. This keeps infrastructure minimal (no Celery/Redis).

For production scale, swap `process_in_background` for a real task queue
(Celery/RQ) — the `run_pipeline` body can be reused verbatim as the task.
"""
import logging
import threading

from django.db import close_old_connections
from django.utils import timezone

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


def _worker(session_id):
    try:
        run_pipeline(session_id)
    finally:
        # Release the thread's DB connection so it isn't leaked.
        close_old_connections()


def process_in_background(session_id):
    """Kick off processing on a daemon thread and return immediately."""
    threading.Thread(target=_worker, args=(session_id,), daemon=True).start()
