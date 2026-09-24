import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { errorMessage } from '../../services/apiClient'
import { billingApi } from '../../services/billing.api'
import { Modal } from '../primitives/Modal'
import { CenteredSpinner } from '../primitives/Spinner'
import { InvoiceViewer } from './InvoiceViewer'

const BTN_SECONDARY = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-all sm:text-sm'
const BTN_PRIMARY = 'inline-flex items-center justify-center gap-2 rounded-xl bg-[#0D9488] border border-[#0B7A70] px-5 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-[#0B7A70] transition-all sm:text-sm'

interface InvoiceViewModalProps {
  invoiceId: number
  onClose: () => void
}

/** Read-only invoice lookup — e.g. from the doctor queue's "previous patient" card,
 * so a completed visit's invoice stays reachable after the completion pop-up closes. */
export function InvoiceViewModal({ invoiceId, onClose }: InvoiceViewModalProps) {
  const { t } = useTranslation()
  const { data: invoice, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['invoices', invoiceId],
    queryFn: () => billingApi.invoice(invoiceId),
  })

  return (
    <Modal title={t('billing.invoiceTitle')} onClose={onClose} wide>
      {isLoading ? (
        <CenteredSpinner />
      ) : isError ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <p className="patient-text-body font-semibold text-rose-700">{t('billing.invoiceLoadError')}</p>
          <p className="text-xs text-rose-500">{errorMessage(error)}</p>
          <button type="button" onClick={() => refetch()} className={BTN_PRIMARY}>
            {t('common.retry')}
          </button>
        </div>
      ) : invoice ? (
        <InvoiceViewer invoice={invoice} />
      ) : (
        <CenteredSpinner />
      )}
      <div className="mt-4 flex justify-end gap-3">
        <button type="button" onClick={onClose} className={BTN_SECONDARY}>{t('common.close')}</button>
      </div>
    </Modal>
  )
}
