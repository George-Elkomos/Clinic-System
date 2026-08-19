// Intl.DateTimeFormat('ar', ...) embeds invisible LRM/RLM/ALM marks (U+200E,
// U+200F, U+061C) around date separators — a hint meant for correct display
// when the string gets embedded inline in RTL Arabic prose. Standing alone in
// a UI element (a list row, a table cell), those same marks instead scramble
// the day/month/year and hour/minute token order, even inside a dir="ltr"
// container. Strip them so the plain "19/08/2026, 7:04 م" token order holds —
// callers still pass dir="ltr" to <BidiText>/<bdi> (see BidiText.tsx) since
// the trailing ص/م marker is a *real* strong-RTL character, not a mark.
const BIDI_FORMATTING_MARKS_RE = /[‎‏؜]/g

function stripBidiFormattingMarks(value: string): string {
  return value.replace(BIDI_FORMATTING_MARKS_RE, '')
}

// Locale-aware date/time formatting (respects the active i18n language).
export function formatDateTime(iso: string, locale: string): string {
  if (!iso) return ''
  return stripBidiFormattingMarks(
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)),
  )
}

export function formatDate(iso: string, locale: string): string {
  if (!iso) return ''
  return stripBidiFormattingMarks(
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso)),
  )
}

export function formatTime(iso: string, locale: string): string {
  if (!iso) return ''
  return stripBidiFormattingMarks(
    new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(new Date(iso)),
  )
}

// Currency display for billing (amounts arrive as decimal strings from DRF).
// The system is single-currency (Egyptian Pound) — the number itself always
// uses Western digits (Intl's ar-EG default renders Arabic-Indic digits,
// e.g. "٥٠٫٠٠", which isn't what's wanted here) with just the unit label
// switching per language.
export function formatCurrency(amount: string | number, language: string): string {
  const value = typeof amount === 'string' ? parseFloat(amount) : amount
  if (Number.isNaN(value)) return ''
  const number = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
  return `${number} ${language === 'ar' ? 'ج.م' : 'EGP'}`
}

// Picks the Arabic variant of a bilingual string pair when the UI is in
// Arabic and a translation exists, else the English/default variant.
export function pickLocalized(en: string, ar: string | undefined | null, language: string): string {
  return language === 'ar' && ar ? ar : en
}

// Picks the Arabic label for bilingual reference data (Specialty, Complaint,
// Diagnosis, ...) when the UI is in Arabic and a translation exists, else EN.
export function localizedName(item: { name: string; name_ar?: string | null }, language: string): string {
  return pickLocalized(item.name, item.name_ar, language)
}

// Maps the app's 2-letter language code onto a full BCP-47 locale tag for
// Intl.* calls (date/number/relative-time formatting).
export function toIntlLocale(language: string): string {
  return language === 'ar' ? 'ar-EG' : 'en-US'
}
