import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useLanguage } from '../../hooks/useLanguage'
import { formatMoney } from '../../lib/format'
import { errorMessage } from '../../services/apiClient'
import { billingApi } from '../../services/billing.api'
import type { Invoice, PaymentMethod } from '../../services/types'
import { Button } from '../primitives/Button'
import { FormField } from '../primitives/FormField'
import { Modal } from '../primitives/Modal'
import { Select } from '../primitives/Select'
import { useToast } from '../primitives/Toast'

const METHODS: PaymentMethod[] = ['CASH', 'CARD', 'BANK_TRANSFER']

interface PaymentFormModalProps {
  invoice: Invoice
  onClose: () => void
}

/** "Record Payment" modal: amount defaults to the outstanding balance. */
export function PaymentFormModal({ invoice, onClose }: PaymentFormModalProps) {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { showToast } = useToast()
  const qc = useQueryClient()
  const [amount, setAmount] = useState(invoice.balance)
  const [method, setMethod] = useState<PaymentMethod>('CASH')
  const [reference, setReference] = useState('')

  const record = useMutation({
    mutationFn: () =>
      billingApi.recordPayment({
        invoice: invoice.id,
        amount,
        payment_method: method,
        reference,
      }),
    onSuccess: (data) => {
      showToast(
        t(data.invoice_detail.status === 'PAID' ? 'billing.invoicePaid' : 'billing.paymentRecorded'),
        'success',
      )
      qc.invalidateQueries({ queryKey: ['invoices'] })
      qc.invalidateQueries({ queryKey: ['billing-report'] })
      onClose()
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  return (
    <Modal title={t('billing.recordPayment')} onClose={onClose}>
      <p style={{ marginTop: 0 }}>
        {invoice.number} · {invoice.patient_name}
        <br />
        <span style={{ color: 'var(--text-muted)' }}>
          {t('billing.balance')}: <strong>{formatMoney(invoice.balance, invoice.currency, language)}</strong>
        </span>
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          record.mutate()
        }}
      >
        <FormField label={t('billing.amount')}>
          {(p) => (
            <input
              {...p}
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          )}
        </FormField>
        <FormField label={t('billing.method')}>
          {(p) => (
            <Select
              id={p.id}
              options={METHODS.map((m) => ({ value: m, label: t(`billing.methods.${m}`) }))}
              value={method}
              onChange={(v) => setMethod((Array.isArray(v) ? 'CASH' : String(v)) as PaymentMethod)}
            />
          )}
        </FormField>
        <FormField label={t('billing.reference')} hint={t('billing.referenceHint')}>
          {(p) => <input {...p} value={reference} onChange={(e) => setReference(e.target.value)} />}
        </FormField>
        <div className="modal__actions">
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" loading={record.isPending}>{t('billing.recordPayment')}</Button>
        </div>
      </form>
    </Modal>
  )
}
