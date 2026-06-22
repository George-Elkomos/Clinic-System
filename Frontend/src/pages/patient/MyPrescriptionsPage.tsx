import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { Button } from '../../components/primitives/Button'
import { Card } from '../../components/primitives/Card'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { useToast } from '../../components/primitives/Toast'
import { useLanguage } from '../../hooks/useLanguage'
import { openBlob } from '../../lib/download'
import { formatDate } from '../../lib/format'
import { errorMessage } from '../../services/apiClient'
import { medicalApi } from '../../services/medical.api'

export function MyPrescriptionsPage() {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { showToast } = useToast()

  const { data: prescriptions = [], isLoading } = useQuery({
    queryKey: ['prescriptions', 'mine'],
    queryFn: () => medicalApi.prescriptions(),
  })

  const openPdf = async (id: number) => {
    try {
      openBlob(await medicalApi.prescriptionPdf(id))
    } catch (err) {
      showToast(errorMessage(err), 'error')
    }
  }

  return (
    <div>
      <Breadcrumbs trail={[{ label: t('nav.prescriptions') }]} />
      <h1>{t('nav.prescriptions')}</h1>
      {isLoading ? (
        <CenteredSpinner />
      ) : prescriptions.length === 0 ? (
        <Card><p>{t('medical.noPrescriptions')}</p></Card>
      ) : (
        prescriptions.map((p) => (
          <Card
            key={p.id}
            title={`${p.doctor_name} · ${t('medical.issuedOn', { date: formatDate(p.issued_date, language) })}`}
          >
            {p.status === 'CANCELLED' && (
              <div className="rx-voided-banner">
                <span className="badge badge--CANCELLED">{t('medical.voidedBadge')}</span>
                {p.cancelled_at && (
                  <span className="rx-voided-meta">
                    {t('medical.voidedOn', { date: formatDate(p.cancelled_at.slice(0, 10), language) })}
                    {p.cancelled_by_name ? ` ${t('medical.voidedBy', { name: p.cancelled_by_name })}` : ''}
                  </span>
                )}
                {p.cancellation_reason && (
                  <p className="rx-voided-reason">{t('medical.voidReason', { reason: p.cancellation_reason })}</p>
                )}
              </div>
            )}
            <ul className={p.status === 'CANCELLED' ? 'rx-items--voided' : ''}>
              {p.items.map((it, i) => (
                <li key={i}>
                  <strong>{it.drug_name}</strong> {it.dosage} — {it.frequency}, {it.duration}
                  {it.instructions ? ` (${it.instructions})` : ''}
                </li>
              ))}
            </ul>
            {p.notes && <p>{p.notes}</p>}
            {p.status !== 'CANCELLED' && (
              <Button variant="secondary" onClick={() => openPdf(p.id)}>{t('medical.openPdf')}</Button>
            )}
          </Card>
        ))
      )}
    </div>
  )
}
