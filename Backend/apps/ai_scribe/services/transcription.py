"""Speech-to-text via faster-whisper (Whisper large-v3, run locally).

The model is loaded once and cached process-wide — loading ~1.5 GB of weights on
every request would be unworkable. `faster_whisper` is imported lazily so the
Django app still boots when the package isn't installed yet.
"""
import logging
import threading

from django.conf import settings

logger = logging.getLogger(__name__)

_model = None
_model_lock = threading.Lock()


class TranscriptionUnavailable(RuntimeError):
    """Raised when faster-whisper can't be loaded (not installed, bad config)."""


def _load_model():
    """Lazy, thread-safe singleton WhisperModel."""
    global _model
    if _model is not None:
        return _model
    with _model_lock:
        if _model is not None:
            return _model
        try:
            from faster_whisper import WhisperModel
        except ImportError as exc:  # pragma: no cover - depends on env
            raise TranscriptionUnavailable(
                "faster-whisper is not installed. Run: pip install faster-whisper"
            ) from exc
        logger.info(
            "Loading Whisper model '%s' (device=%s, compute=%s)…",
            settings.WHISPER_MODEL_SIZE, settings.WHISPER_DEVICE, settings.WHISPER_COMPUTE_TYPE,
        )
        _model = WhisperModel(
            settings.WHISPER_MODEL_SIZE,
            device=settings.WHISPER_DEVICE,
            compute_type=settings.WHISPER_COMPUTE_TYPE,
            download_root=settings.WHISPER_MODEL_DIR,
        )
        return _model


def transcribe(audio_path, language=None):
    """Transcribe an audio file.

    `language` of "" / None lets Whisper auto-detect (handy when the session is
    Arabic with a few English drug names). Returns (text, segments) where each
    segment is {"start", "end", "text"}.
    """
    model = _load_model()
    lang = language or settings.WHISPER_DEFAULT_LANGUAGE or None
    segments_iter, info = model.transcribe(
        str(audio_path),
        language=lang,
        vad_filter=True,  # skip long silences -> faster + cleaner transcript
        beam_size=5,
    )
    segments = []
    parts = []
    for seg in segments_iter:  # generator: transcription happens as we iterate
        text = seg.text.strip()
        segments.append({"start": round(seg.start, 2), "end": round(seg.end, 2), "text": text})
        parts.append(text)
    logger.info("Transcribed %s: %d segments, detected lang=%s",
                audio_path, len(segments), getattr(info, "language", "?"))
    return " ".join(parts).strip(), segments
