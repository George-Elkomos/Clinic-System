// Idempotency-Key helpers for Finance mutations (payments, credit notes,
// refunds, cash movements). Header name and replay/conflict semantics per
// Backend/apps/billing/idempotency.py: same key + same fields is a safe
// no-op replay; same key + different fields is a 409.

export const IDEMPOTENCY_HEADER = 'Idempotency-Key'

export function createIdempotencyKey(): string {
  return crypto.randomUUID()
}

export function idempotencyHeader(key: string): Record<string, string> {
  return { [IDEMPOTENCY_HEADER]: key }
}

/**
 * Deterministic string for a request payload, independent of key order, so
 * two calls with the same fields (regardless of how the object was built)
 * fingerprint identically. Used to tell "retry of the same attempt" apart
 * from "the user changed something and submitted again".
 */
export function fingerprintPayload(payload: unknown): string {
  return stableStringify(payload)
}

function stableStringify(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
}
