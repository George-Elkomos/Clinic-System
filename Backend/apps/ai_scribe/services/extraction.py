"""Turn a consultation transcript into a structured clinical draft.

Provider: Google Gemini (free tier). This is the ONLY module that knows about
the LLM vendor — to switch to Groq/OpenAI, reimplement `extract()` and keep the
same return contract (a dict matching services.schema.empty_draft()).

The model receives the raw transcript (Arabic, possibly with English drug names)
and returns JSON. Output is always run through `normalize_draft` so callers get
a predictable shape regardless of what the model emits.
"""
import json
import logging

from django.conf import settings

from .schema import normalize_draft

logger = logging.getLogger(__name__)


class ExtractionUnavailable(RuntimeError):
    """Raised when the LLM provider isn't configured or installed."""


_SYSTEM_INSTRUCTION = """You are a clinical documentation assistant for a doctor in Egypt.
You will receive the transcript of a spoken consultation between a doctor and a patient.
The transcript is mostly Egyptian Arabic and may contain English drug or test names.

Extract the clinical information the doctor needs to record and return it as a SINGLE
JSON object with EXACTLY these keys:

{
  "chief_complaint": "the main reason for the visit, in the transcript's language",
  "diagnosis": "the doctor's diagnosis / impression",
  "treatment_plan": "the plan: procedures, advice, referrals",
  "clinical_summary": "a short narrative summary of the encounter",
  "follow_up": "any follow-up instructions or next appointment guidance",
  "vitals": {
    "blood_pressure": "", "heart_rate": "", "temperature": "",
    "respiratory_rate": "", "oxygen_saturation": "", "weight": "", "height": "",
    "notes": ""
  },
  "prescriptions": [
    {"drug_name": "", "dosage": "", "frequency": "", "duration": "", "instructions": ""}
  ]
}

Rules:
- Use ONLY information present in the transcript. Do NOT invent diagnoses, drugs, or doses.
- If something was not mentioned, leave that string empty ("") or the list empty ([]).
- Keep the clinical content in its original language (Arabic stays Arabic).
- Numeric vitals: include the value with its unit if stated (e.g. "120/80", "37.5 C").
- Return ONLY the JSON object — no markdown, no commentary.
"""


def _client():
    if not settings.GEMINI_API_KEY:
        raise ExtractionUnavailable(
            "GEMINI_API_KEY is not set. Get a free key at https://aistudio.google.com/apikey"
        )
    try:
        from google import genai
    except ImportError as exc:  # pragma: no cover - depends on env
        raise ExtractionUnavailable(
            "google-genai is not installed. Run: pip install google-genai"
        ) from exc
    return genai


def _parse_json(text):
    """Parse the model's JSON, tolerating ```json fences and stray prose."""
    text = (text or "").strip()
    if text.startswith("```"):
        # strip leading ```json / ``` and trailing ```
        text = text.split("```", 2)
        text = text[1] if len(text) > 1 else ""
        if text.lstrip().lower().startswith("json"):
            text = text.lstrip()[4:]
        text = text.rsplit("```", 1)[0]
    try:
        return json.loads(text)
    except (json.JSONDecodeError, TypeError):
        # last resort: grab the outermost {...}
        start, end = text.find("{"), text.rfind("}")
        if 0 <= start < end:
            try:
                return json.loads(text[start:end + 1])
            except json.JSONDecodeError:
                pass
    return {}


def extract(transcript):
    """transcript -> normalized clinical draft dict. Raises ExtractionUnavailable
    if the provider isn't configured."""
    if not (transcript or "").strip():
        return normalize_draft({})

    genai = _client()
    from google.genai import types

    client = genai.Client(api_key=settings.GEMINI_API_KEY)
    response = client.models.generate_content(
        model=settings.GEMINI_MODEL,
        contents=f"Consultation transcript:\n\n{transcript}",
        config=types.GenerateContentConfig(
            system_instruction=_SYSTEM_INSTRUCTION,
            response_mime_type="application/json",
            temperature=0.1,
        ),
    )
    raw = _parse_json(getattr(response, "text", ""))
    logger.info("Extraction produced keys: %s", list(raw) if isinstance(raw, dict) else type(raw))
    return normalize_draft(raw)
