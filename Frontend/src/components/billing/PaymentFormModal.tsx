import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useLanguage } from '../../hooks/useLanguage'
import { formatMoney } from '../../lib/format'
import { errorMessage } from '../../services/apiClient'
import { billingApi } from '../../services/billing.api'
import type { Invoice, PaymentMethod } from '../../services/types'
import { FormField } from '../primitives/FormField'
import { Modal } from '../primitives/Modal'
import { Select } from '../primitives/Select'
import { Spinner } from '../primitives/Spinner'
import { useToast } from '../primitives/Toast'

const METHODS: PaymentMethod[] = ['CASH', 'CARD', 'BANK_TRANSFER']
const BTN_PRIMARY = 'inline-flex items-center justify-center gap-2 rounded-xl bg-[#0D9488] border border-[#0B7A70] px-5 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-[#0B7A70] transition-all disabled:opacity-60 sm:text-sm'
const BTN_SECONDARY = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-all disabled:opacity-60 sm:text-sm'

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
      <p className="patient-text-body mt-0" style={{ color: 'var(--text-primary)' }}>
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
              className="patient-field"
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
          {(p) => <input {...p} className="patient-field" value={reference} onChange={(e) => setReference(e.target.value)} />}
        </FormField>
        <div className="mt-4 flex flex-wrap justify-end gap-3">
          <button type="button" onClick={onClose} className={BTN_SECONDARY}>{t('common.cancel')}</button>
          <button type="submit" disabled={record.isPending} className={BTN_PRIMARY}>
            {record.isPending && <Spinner size={14} />}{t('billing.recordPayment')}
          </button>
        </div>
      </form>
    </Modal>
  )
}
