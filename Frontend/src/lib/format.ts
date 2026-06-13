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
