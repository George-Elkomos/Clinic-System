import { describe, expect, it } from 'vitest'

import { createIdempotencyKey, IDEMPOTENCY_HEADER, idempotencyHeader } from './idempotency'

// Backend/apps/billing/views.py `_require_idempotency_key`: ^[A-Za-z0-9_.:-]{1,255}$
const BACKEND_ALLOWED_KEY = /^[A-Za-z0-9_.:-]{1,255}$/

describe('createIdempotencyKey', () => {
  it('produces keys that satisfy the backend-allowed format', () => {
    const key = createIdempotencyKey()
    expect(key).toMatch(BACKEND_ALLOWED_KEY)
  })

  it('produces a different key on each call', () => {
    const a = createIdempotencyKey()
    const b = createIdempotencyKey()
    expect(a).not.toBe(b)
  })
})

describe('idempotencyHeader', () => {
  it('uses the exact header name the backend expects', () => {
    expect(IDEMPOTENCY_HEADER).toBe('Idempotency-Key')
  })

  it('wraps the key under that exact header name', () => {
    const key = createIdempotencyKey()
    expect(idempotencyHeader(key)).toEqual({ 'Idempotency-Key': key })
  })
})
