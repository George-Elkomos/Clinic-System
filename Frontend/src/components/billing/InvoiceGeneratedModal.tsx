import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useLanguage } from '../../hooks/useLanguage'
import { formatMoney } from '../../lib/format'
import { billingApi } from '../../services/billing.api'
import type { AppointmentBilling } from '../../services/types'
import { Button } from '../primitives/Button'
import { Modal } from '../primitives/Modal'
import { CenteredSpinner } from '../primitives/Spinner'
import { InvoiceViewer } from './InvoiceViewer'
import { printInvoice } from './print'

interface InvoiceGeneratedModalProps {
  billing: AppointmentBilling
  onClose: () => void
}

/**
 * Post-completion pop-up: "Invoice #INV-XXXX generated. [View Invoice]
 * [Print Receipt]" — or the free-follow-up variant when no invoice was issued.
 */
export function InvoiceGeneratedModal({ billing, onClose }: InvoiceGeneratedModalProps) {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const [showInvoice, setShowInvoice] = useState(false)
  // "Print Receipt" clicked before the sheet finished loading (ref: no re-render needed).
  const printPending = useRef(false)

  const { data: invoice } = useQuery({
    queryKey: ['invoices', billing.invoice_id],
    queryFn: () => billingApi.invoice(billing.invoice_id!),
    enabled: showInvoice && billing.invoice_id != null,
  })

  useEffect(() => {
    if (printPending.current && invoice) {
      printPending.current = false
      printInvoice()
    }
  }, [invoice])

  if (billing.free_followup_used) {
    return (
      <Modal title={t('billing.visitCompleted')} onClose={onClose}>
        <p>{t('billing.freeFollowupUsed')}</p>
        <div className="modal__actions">
          <Button onClick={onClose}>{t('common.done')}</Button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title={t('billing.visitCompleted')} onClose={onClose} wide={showInvoice}>
      <p>
        {t('billing.invoiceGenerated', {
          number: billing.invoice_number,
          total: billing.invoice_total
            ? formatMoney(billing.invoice_total, invoice?.currency ?? 'USD', language)
            : '',
        })}
      </p>

      {showInvoice && (invoice ? <InvoiceViewer invoice={invoice} /> : <CenteredSpinner />)}

      <div className="modal__actions">
        <Button variant="secondary" onClick={onClose}>{t('common.close')}</Button>
        {!showInvoice && (
          <Button variant="secondary" onClick={() => setShowInvoice(true)}>
            {t('billing.viewInvoice')}
          </Button>
        )}
        <Button
          onClick={() => {
            setShowInvoice(true)
            if (invoice) printInvoice()
            else printPending.current = true
          }}
        >
          {t('billing.printReceipt')}
        </Button>
      </div>
    </Modal>
  )
}
