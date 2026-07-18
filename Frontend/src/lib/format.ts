// Locale-aware date/time formatting (respects the active i18n language).
export function formatDateTime(iso: string, locale: string): string {
  if (!iso) return ''
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso))
}

export function formatDate(iso: string, locale: string): string {
  if (!iso) return ''
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso))
}

export function formatTime(iso: string, locale: string): string {
  if (!iso) return ''
  return new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(new Date(iso))
}

// Currency display for billing (amounts arrive as decimal strings from DRF).
export function formatMoney(amount: string | number, currency: string, locale: string): string {
  const value = typeof amount === 'string' ? parseFloat(amount) : amount
  if (Number.isNaN(value)) return ''
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value)
}

// Picks the Arabic label for bilingual reference data (Specialty, Complaint,
// Diagnosis, ...) when the UI is in Arabic and a translation exists, else EN.
export function localizedName(item: { name: string; name_ar?: string | null }, language: string): string {
  return language === 'ar' && item.name_ar ? item.name_ar : item.name
}
