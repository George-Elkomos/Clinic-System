"""Small text-normalization helpers shared across apps."""
from django.utils import timezone

# Unicode First Strong Isolate / Pop Directional Isolate. Wrapping an embedded
# run of text in these marks tells the Unicode Bidi Algorithm to resolve that
# run's direction from its own content, independent of the surrounding
# sentence. Without this, a Latin-script name/code/date embedded near the end
# of an Arabic (RTL) sentence can drag trailing punctuation (؟ . ,) to the
# wrong visual side. Plain Unicode characters work in-string, so this fixes
# plain-text channels (email/SMS/WhatsApp) as well as in-app HTML rendering.
_FSI = "⁦"
_PDI = "⁩"


def bidi_isolate(value) -> str:
    """Isolate a value about to be embedded inside a sentence that may run in
    the opposite direction (a name, reference code, or date inside an Arabic
    sentence)."""
    text = str(value)
    return f"{_FSI}{text}{_PDI}" if text else text


def bidi_name(user) -> str:
    """Full name (no honorific), isolated for embedding inside an Arabic
    sentence."""
    return bidi_isolate(user.get_full_name() or user.email)


def format_when_bilingual(dt) -> tuple[str, str]:
    """Render a datetime for notification text in both languages.

    Returns (english, arabic). Both sides use a 12-hour clock with an
    explicit period marker (AM/PM, ص/م) rather than 24-hour military time --
    strftime's %p is locale-independent (always "AM"/"PM" in the C locale
    Python runs under), so the ص/م marker is built by hand instead. The
    Arabic side uses the numeric ar-EG date style (dd/mm/yyyy) rather than a
    spelled-out month, and is pre-isolated since it's always embedded inside
    an Arabic sentence.

    `dt` is converted to the current TIME_ZONE (Africa/Cairo) first --
    DateTimeField values come back UTC-aware straight from the DB, and
    formatting that raw UTC value directly would show a clock time hours off
    from the appointment's actual local time.
    """
    dt = timezone.localtime(dt)
    hour12 = dt.hour % 12 or 12
    minute = f"{dt.minute:02d}"
    en = f"{dt.strftime('%d %b %Y')}, {hour12}:{minute} {'AM' if dt.hour < 12 else 'PM'}"
    ar = bidi_isolate(f"{dt.strftime('%d/%m/%Y')}, {hour12}:{minute} {'ص' if dt.hour < 12 else 'م'}")
    return en, ar


_AR_MONTHS = [
    "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
    "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
]


def format_when_short_bilingual(dt) -> tuple[str, str]:
    """Render a datetime as 'day month, HH:MM AM/PM' -- no year, hour
    zero-padded -- for notification text where "which day, roughly" is
    enough context (unlike format_when_bilingual's year-inclusive form,
    meant to stand as a full timestamp on its own). The Arabic side spells
    out the month name (unlike format_when_bilingual's numeric dd/mm) since
    this is meant to read as a short, natural phrase rather than a date
    field, and is pre-isolated since it's always embedded inside an Arabic
    sentence. `dt` is converted to local time first -- see
    format_when_bilingual's docstring for why.
    """
    dt = timezone.localtime(dt)
    hour12 = dt.hour % 12 or 12
    minute = f"{dt.minute:02d}"
    en = f"{dt.strftime('%d %b')}, {hour12:02d}:{minute} {'AM' if dt.hour < 12 else 'PM'}"
    ar = bidi_isolate(
        f"{dt.day:02d} {_AR_MONTHS[dt.month - 1]}، {hour12:02d}:{minute} {'ص' if dt.hour < 12 else 'م'}"
    )
    return en, ar


def doctor_display_name(doctor, *, arabic: bool = False) -> str:
    """'Dr. Jane Doe' / 'د. جين دو' — same name, locale-appropriate honorific.

    Doesn't touch DoctorProfile.__str__ (used app-wide for admin/PDF/English
    contexts) since only bilingual notification text needs the Arabic form.
    The Arabic form prioritizes the doctor's own name_ar (falling back to the
    English name only if it's blank) so an Arabic notification never reads a
    Latin-script name; it isolates whatever name it ends up with so a
    Latin-script fallback doesn't disrupt the surrounding Arabic sentence.
    """
    if arabic:
        name = doctor.user.name_ar or doctor.user.get_full_name() or doctor.user.email
        return f"د. {bidi_isolate(name)}"
    name = doctor.user.get_full_name() or doctor.user.email
    return f"Dr. {name}"


def capitalize_first(value: str) -> str:
    """Uppercase only the first character, leaving the rest untouched.

    Deliberately not str.title()/str.capitalize(): those mangle names that
    already have internal capitals or particles (McDonald -> Mcdonald,
    AlSayed -> Alsayed). This only fixes a value that starts lowercase;
    anything already correctly cased is left alone.
    """
    return value[:1].upper() + value[1:] if value else value
