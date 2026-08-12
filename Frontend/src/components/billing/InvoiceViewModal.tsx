import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { billingApi } from '../../services/billing.api'
import { Modal } from '../primitives/Modal'
import { CenteredSpinner } from '../primitives/Spinner'
import { InvoiceViewer } from './InvoiceViewer'

const BTN_SECONDARY = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-xs font-medium text-slate-700 transition-all hover:border-[#0D9488] hover:text-[#0D9488] sm:text-sm'

interface InvoiceViewModalProps {
  invoiceId: number
  onClose: () => void
}

/** Read-only invoice lookup — e.g. from the doctor queue's "previous patient" card,
 * so a completed visit's invoice stays reachable after the completion pop-up closes. */
export function InvoiceViewModal({ invoiceId, onClose }: InvoiceViewModalProps) {
  const { t } = useTranslation()
  const { data: invoice } = useQuery({
    queryKey: ['invoices', invoiceId],
    queryFn: () => billingApi.invoice(invoiceId),
  })

  return (
    <Modal title={t('billing.invoiceTitle')} onClose={onClose} wide>
      {invoice ? <InvoiceViewer invoice={invoice} /> : <CenteredSpinner />}
      <div className="mt-4 flex justify-end gap-3">
        <button type="button" onClick={onClose} className={BTN_SECONDARY}>{t('common.close')}</button>
      </div>
    </Modal>
  )
}
