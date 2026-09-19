import { useCallback, useRef } from 'react'

import { createIdempotencyKey, fingerprintPayload } from '../lib/idempotency'

/**
 * Owns the Idempotency-Key for one Finance mutation "slot" (e.g. one
 * PaymentFormModal instance). Call `getKey(payload)` right before firing the
 * request and send it as the `Idempotency-Key` header:
 *
 *   const idempotency = useIdempotencyKey()
 *   const mutation = useMutation({
 *     mutationFn: (payload) => financeApi.recordPayment(payload, idempotency.getKey(payload)),
 *     onSuccess: () => idempotency.reset(),
 *   })
 *
 * Behavior:
 *  - Same payload as last call (a retry after a network/transient failure,
 *    since the component is still mounted with nothing reset) -> same key.
 *  - Different payload (the user edited an amount/field) -> a new key,
 *    generated automatically, no explicit reset needed.
 *  - After `reset()` (call this in onSuccess, and optionally when a modal
 *    closes/reopens) the next `getKey` call starts a new logical attempt
 *    with a fresh key, even if the payload happens to be identical — so a
 *    deliberate second submission is never silently treated as a replay of
 *    the first.
 */
export function useIdempotencyKey() {
  const keyRef = useRef<string | null>(null)
  const fingerprintRef = useRef<string | null>(null)

  const getKey = useCallback((payload: unknown): string => {
    const fingerprint = fingerprintPayload(payload)
    if (keyRef.current === null || fingerprintRef.current !== fingerprint) {
      keyRef.current = createIdempotencyKey()
      fingerprintRef.current = fingerprint
    }
    return keyRef.current
  }, [])

  const reset = useCallback(() => {
    keyRef.current = null
    fingerprintRef.current = null
  }, [])

  return { getKey, reset }
}
