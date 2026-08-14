import { useQuery } from '@tanstack/react-query'
import { Printer } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { CenteredSpinner, Spinner } from '../../components/primitives/Spinner'
import { useToast } from '../../components/primitives/Toast'
import { useLanguage } from '../../hooks/useLanguage'
import { openBlob } from '../../lib/download'
import { formatDate } from '../../lib/format'
import { errorMessage } from '../../services/apiClient'
import { medicalApi } from '../../services/medical.api'

const CARD = 'rounded-2xl border border-[#F3F4F6] bg-white p-5 shadow-sm sm:p-6'
const BTN_SECONDARY_SM = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-all disabled:opacity-60'
const STATUS_BADGE: Record<string, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 border-emerald-200/60',
  COMPLETED: 'bg-slate-50 text-slate-500 border-slate-200/60',
  CANCELLED: 'bg-rose-50 text-rose-700 border-rose-200/60',
}

// Secretary-facing, read-only: view status and print/hand over a copy —
// no create/edit access (that stays doctor-exclusive).
export function PrescriptionsDeskPage() {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { showToast } = useToast()
  const [openingId, setOpeningId] = useState<number | null>(null)

  const { data: prescriptions = [], isLoading } = useQuery({
    queryKey: ['prescriptions', 'desk'],
    queryFn: () => medicalApi.prescriptions(),
  })

  const openPdf = async (id: number) => {
    setOpeningId(id)
    try {
      openBlob(await medicalApi.prescriptionPdf(id))
    } catch (err) {
      showToast(errorMessage(err), 'error')
    } finally {
      setOpeningId(null)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Breadcrumbs trail={[{ label: t('nav.prescriptions') }]} />
        <h1 className="patient-text-page-title lg:hidden" style={{ color: 'var(--text-primary)' }}>
          {t('nav.prescriptions')}
        </h1>
        <p className="patient-text-body-secondary mt-1" style={{ color: 'var(--text-secondary)' }}>
          {t('medical.prescriptionsDeskIntro')}
        </p>
      </div>

      <div className={CARD}>
        {isLoading ? (
          <CenteredSpinner />
        ) : prescriptions.length === 0 ? (
          <p className="patient-text-body-secondary" style={{ color: 'var(--text-secondary)' }}>{t('medical.noPrescriptionsTitle')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-slate-100">
                  {[t('appointments.patient'), t('appointments.doctor'), t('appointments.when'), t('appointments.status'), ''].map((h) => (
                    <th key={h || 'actions'} className="patient-text-overline px-3 py-2 text-left" style={{ color: 'var(--text-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {prescriptions.map((p) => (
                  <tr key={p.id} className="border-b border-slate-100">
                    <td className="px-3 py-2.5 font-semibold" style={{ color: 'var(--text-primary)' }}>{p.patient_name}</td>
                    <td className="px-3 py-2.5" style={{ color: 'var(--text-primary)' }}>{p.doctor_name}</td>
                    <td className="px-3 py-2.5" style={{ color: 'var(--text-muted)' }}>{formatDate(p.issued_date, language)}</td>
                    <td className="px-3 py-2.5">
                      <span className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold ${STATUS_BADGE[p.status] ?? STATUS_BADGE.COMPLETED}`}>
                        {t(`status.${p.status}`)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      {p.status !== 'CANCELLED' && (
                        <button
                          type="button"
                          disabled={openingId === p.id}
                          onClick={() => openPdf(p.id)}
                          className={BTN_SECONDARY_SM}
                        >
                          {openingId === p.id ? <Spinner size={12} /> : <Printer size={12} />}
                          {t('medical.openPdf')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
