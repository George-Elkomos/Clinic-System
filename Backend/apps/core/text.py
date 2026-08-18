"""Small text-normalization helpers shared across apps."""

_AR_MONTHS = (
    "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
    "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
)


def format_when_bilingual(dt) -> tuple[str, str]:
    """Render a datetime for notification text in both languages.

    Used instead of a single strftime() so an Arabic notification body never
    ends up with an English month abbreviation stuck in the middle of it.
    Returns (english, arabic).
    """
    en = dt.strftime("%d %b %Y, %H:%M")
    ar = f"{dt.day} {_AR_MONTHS[dt.month - 1]} {dt.year}، {dt.strftime('%H:%M')}"
    return en, ar


def doctor_display_name(doctor, *, arabic: bool = False) -> str:
    """'Dr. Jane Doe' / 'د. جين دو' — same name, locale-appropriate honorific.

    Doesn't touch DoctorProfile.__str__ (used app-wide for admin/PDF/English
    contexts) since only bilingual notification text needs the Arabic form.
    """
    name = doctor.user.get_full_name() or doctor.user.email
    return f"د. {name}" if arabic else f"Dr. {name}"


def capitalize_first(value: str) -> str:
    """Uppercase only the first character, leaving the rest untouched.

    Deliberately not str.title()/str.capitalize(): those mangle names that
    already have internal capitals or particles (McDonald -> Mcdonald,
    AlSayed -> Alsayed). This only fixes a value that starts lowercase;
    anything already correctly cased is left alone.
    """
    return value[:1].upper() + value[1:] if value else value
