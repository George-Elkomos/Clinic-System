import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useLanguage } from '../../hooks/useLanguage'
import { formatCurrency } from '../../lib/format'
import { billingApi } from '../../services/billing.api'
import type { AppointmentBilling } from '../../services/types'
import { Modal } from '../primitives/Modal'
import { CenteredSpinner } from '../primitives/Spinner'
import { InvoiceViewer } from './InvoiceViewer'
import { printInvoice } from './print'

const BTN_PRIMARY = 'inline-flex items-center justify-center gap-2 rounded-xl bg-[#0D9488] border border-[#0B7A70] px-5 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-[#0B7A70] transition-all sm:text-sm'
const BTN_SECONDARY = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-all sm:text-sm'

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
        <div className="mt-4 flex justify-end gap-3">
          <button type="button" onClick={onClose} className={BTN_PRIMARY}>{t('common.done')}</button>
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
            ? formatCurrency(billing.invoice_total, language)
            : '',
        })}
      </p>

      {showInvoice && (invoice ? <InvoiceViewer invoice={invoice} /> : <CenteredSpinner />)}

      <div className="mt-4 flex flex-wrap justify-end gap-3">
        <button type="button" onClick={onClose} className={BTN_SECONDARY}>{t('common.close')}</button>
        {!showInvoice && (
          <button type="button" onClick={() => setShowInvoice(true)} className={BTN_SECONDARY}>
            {t('billing.viewInvoice')}
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setShowInvoice(true)
            if (invoice) printInvoice()
            else printPending.current = true
          }}
          className={BTN_PRIMARY}
        >
          {t('billing.printReceipt')}
        </button>
      </div>
    </Modal>
  )
}
