"""Small text-normalization helpers shared across apps."""

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

    Returns (english, arabic). The Arabic side uses the numeric ar-EG style
    (dd/mm/yyyy, HH:MM) rather than a spelled-out month, and is pre-isolated
    since it's always embedded inside an Arabic sentence.
    """
    en = dt.strftime("%d %b %Y, %H:%M")
    ar = bidi_isolate(dt.strftime("%d/%m/%Y, %H:%M"))
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
