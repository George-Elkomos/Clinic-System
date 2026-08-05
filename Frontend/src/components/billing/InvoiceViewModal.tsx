import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { billingApi } from '../../services/billing.api'
import { Button } from '../primitives/Button'
import { Modal } from '../primitives/Modal'
import { CenteredSpinner } from '../primitives/Spinner'
import { InvoiceViewer } from './InvoiceViewer'

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
      <div className="modal__actions">
        <Button variant="secondary" onClick={onClose}>{t('common.close')}</Button>
      </div>
    </Modal>
  )
}
