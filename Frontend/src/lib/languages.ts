/** Fixed vocabulary shared by every doctor-language editor (doctor self-edit,
 * secretary/manager edit) so a language picked in one always displays in the
 * other — matching by value, not by whatever casing was typed. */
export const LANGUAGE_OPTIONS = [
  'Arabic', 'English', 'French', 'German', 'Spanish', 'Italian',
  'Russian', 'Turkish', 'Urdu', 'Hindi', 'Chinese', 'Portuguese',
].map((label) => ({ value: label, label }))

/** Parses the stored comma-separated string into option values, normalizing
 * case against LANGUAGE_OPTIONS (e.g. a stray "arabic" from older free-text
 * data resolves to "Arabic") so it still matches its option and renders. */
export function parseLanguages(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((raw) => LANGUAGE_OPTIONS.find((o) => o.value.toLowerCase() === raw.toLowerCase())?.value ?? raw)
}
