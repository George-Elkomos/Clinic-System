import { createElement, useRef, useState, type ReactNode } from 'react'

import { InteractionWarningModal } from '../components/medical/InteractionWarningModal'
import { useToast } from '../components/primitives/Toast'
import { errorMessage } from '../services/apiClient'
import { medicalApi } from '../services/medical.api'
import type { AllergyInteractionWarning, PrescriptionItem } from '../services/types'

/**
 * Runs a drug-allergy check before a prescription is issued. Collects the linked
 * `medication` ids from the items, calls the backend, and — if any warnings come
 * back — shows a blocking modal. With no medication ids or no warnings, the
 * `onProceed` callback fires immediately. A check failure does not block
 * prescribing (advisory only); it toasts and proceeds.
 *
 * Render the returned `modal` element somewhere in the consuming component.
 */
export function useInteractionCheck() {
  const { showToast } = useToast()
  const [warnings, setWarnings] = useState<AllergyInteractionWarning[] | null>(null)
  const [checking, setChecking] = useState(false)
  const pendingProceed = useRef<(() => void) | null>(null)

  const checkBeforeSubmit = async (
    patientId: number,
    items: PrescriptionItem[],
    onProceed: () => void,
  ) => {
    const medicationIds = items
      .map((i) => i.medication)
      .filter((id): id is number => typeof id === 'number')

    if (medicationIds.length === 0) {
      onProceed()
      return
    }

    setChecking(true)
    try {
      const result = await medicalApi.checkInteractions(patientId, medicationIds)
      if (result.length === 0) {
        onProceed()
        return
      }
      pendingProceed.current = onProceed
      setWarnings(result)
    } catch (err) {
      // Advisory check — never hard-block issuing on a transient failure.
      showToast(errorMessage(err), 'error')
      onProceed()
    } finally {
      setChecking(false)
    }
  }

  const handleProceed = () => {
    const fn = pendingProceed.current
    pendingProceed.current = null
    setWarnings(null)
    fn?.()
  }

  const handleCancel = () => {
    pendingProceed.current = null
    setWarnings(null)
  }

  const modal: ReactNode = warnings
    ? createElement(InteractionWarningModal, {
        warnings,
        onProceed: handleProceed,
        onCancel: handleCancel,
      })
    : null

  return { checkBeforeSubmit, checking, modal }
}
