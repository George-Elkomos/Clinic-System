import { describe, expect, it, vi } from 'vitest'

vi.mock('./apiClient', () => ({
  api: { get: vi.fn(), post: vi.fn().mockResolvedValue({ data: {} }) },
}))

import { api } from './apiClient'
import { billingApi } from './billing.api'

const postMock = vi.mocked(api.post)

describe('billingApi.recordPayment', () => {
  it('sends the caller-supplied key under the exact Idempotency-Key header, payload unchanged', async () => {
    const payload = {
      invoice: 7,
      amount: '50.00',
      payment_method: 'CASH' as const,
      reference: 'RCPT-1',
    }

    await billingApi.recordPayment(payload, 'abc-123')

    expect(postMock).toHaveBeenCalledWith('/payments/', payload, {
      headers: { 'Idempotency-Key': 'abc-123' },
    })
  })

  it('does not mutate or wrap the payload to carry the key inline', async () => {
    const payload = { invoice: 3, amount: '10.00', payment_method: 'CARD' as const }

    await billingApi.recordPayment(payload, 'key-xyz')

    const [, sentBody] = postMock.mock.calls.at(-1)!
    expect(sentBody).toEqual(payload)
    expect(sentBody).not.toHaveProperty('idempotency_key')
    expect(sentBody).not.toHaveProperty('Idempotency-Key')
  })
})
