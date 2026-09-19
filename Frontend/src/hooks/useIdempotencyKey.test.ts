import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useIdempotencyKey } from './useIdempotencyKey'

const BACKEND_ALLOWED_KEY = /^[A-Za-z0-9_.:-]{1,255}$/

describe('useIdempotencyKey', () => {
  it('reuses the same key for an unchanged payload (retry after a failure)', () => {
    const { result } = renderHook(() => useIdempotencyKey())
    const payload = { invoice: 1, amount: '10.00', payment_method: 'CASH' }

    const first = result.current.getKey(payload)
    // A fresh object with the same fields — simulates a retry of the same
    // form submission, not a reference-equal payload.
    const retry = result.current.getKey({ invoice: 1, amount: '10.00', payment_method: 'CASH' })

    expect(retry).toBe(first)
  })

  it('generates a new key when the payload changes', () => {
    const { result } = renderHook(() => useIdempotencyKey())

    const first = result.current.getKey({ invoice: 1, amount: '10.00' })
    const changed = result.current.getKey({ invoice: 1, amount: '20.00' })

    expect(changed).not.toBe(first)
  })

  it('generates a new key after reset(), even for an identical payload', () => {
    const { result } = renderHook(() => useIdempotencyKey())
    const payload = { invoice: 1, amount: '10.00' }

    const first = result.current.getKey(payload)
    result.current.reset()
    const nextAttempt = result.current.getKey(payload)

    expect(nextAttempt).not.toBe(first)
  })

  it('returns keys that satisfy the backend-allowed Idempotency-Key format', () => {
    const { result } = renderHook(() => useIdempotencyKey())
    const key = result.current.getKey({ invoice: 1, amount: '10.00' })

    expect(key).toMatch(BACKEND_ALLOWED_KEY)
  })
})
