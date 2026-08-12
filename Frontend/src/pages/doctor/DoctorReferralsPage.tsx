import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { CenteredSpinner, Spinner } from '../../components/primitives/Spinner'
import { useToast } from '../../components/primitives/Toast'
import { useAuth } from '../../hooks/useAuth'
import { useLanguage } from '../../hooks/useLanguage'
import { formatDate, localizedName } from '../../lib/format'
import { errorMessage } from '../../services/apiClient'
import { referralsApi } from '../../services/referrals.api'
import type { Referral, ReferralStatus } from '../../services/types'

type Tab = 'received' | 'sent'

const CARD = 'rounded-2xl border border-[#F3F4F6] bg-white p-5 shadow-sm sm:p-6'
const BTN_PRIMARY = 'inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#1AB5B3] to-[#38E4DD] px-4 py-2 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-95 disabled:opacity-60'
const BTN_DANGER = 'inline-flex items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-medium text-rose-600 transition-all hover:bg-rose-100 disabled:opacity-60'

const REFERRAL_STATUS_BADGE: Record<ReferralStatus, string> = {
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200/60',
  ACCEPTED: 'bg-sky-50 text-sky-700 border-sky-200/60',
  COMPLETED: 'bg-emerald-50 text-emerald-700 border-emerald-200/60',
  CANCELLED: 'bg-slate-50 text-slate-500 border-slate-200/60',
}

function ReferralDestination({ referral }: { referral: Referral }) {
  const { t } = useTranslation()
  const { language } = useLanguage()
  if (referral.referral_type === 'EXTERNAL') return <span>{referral.external_facility_name}</span>
  return (
    <span>
      {referral.specialty_detail ? localizedName(referral.specialty_detail, language) : t('referrals.internal')}
      {referral.target_doctor_name && ` · ${referral.target_doctor_name}`}
    </span>
  )
}

export function DoctorReferralsPage() {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { user } = useAuth()
  const { showToast } = useToast()
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('received')
  const myDoctorId = user?.doctor_profile?.id

  const { data, isLoading } = useQuery({
    queryKey: ['referrals', 'doctor'],
    queryFn: () => referralsApi.list(),
  })

  const rows = data?.results ?? []
  const sent = rows.filter((r) => r.referring_doctor === myDoctorId)
  const received = rows.filter((r) => r.referring_doctor !== myDoctorId)
  const visible = tab === 'sent' ? sent : received

  const invalidate = () => qc.invalidateQueries({ queryKey: ['referrals'] })
  const onError = (err: unknown) => showToast(errorMessage(err), 'error')

  const accept = useMutation({
    mutationFn: (id: number) => referralsApi.accept(id),
    onSuccess: () => { showToast(t('referrals.accepted'), 'success'); invalidate() },
    onError,
  })
  const complete = useMutation({
    mutationFn: (id: number) => referralsApi.complete(id),
    onSuccess: () => { showToast(t('referrals.completed'), 'success'); invalidate() },
    onError,
  })
  const cancel = useMutation({
    mutationFn: (id: number) => referralsApi.cancel(id),
    onSuccess: () => { showToast(t('referrals.cancelled'), 'success'); invalidate() },
    onError,
  })

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Breadcrumbs trail={[{ label: t('nav.referrals') }]} />
        <h1 className="patient-text-page-title lg:hidden" style={{ color: 'var(--text-primary)' }}>{t('nav.referrals')}</h1>
      </div>

      <div className="flex gap-2" role="tablist">
        {(['received', 'sent'] as Tab[]).map((key) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={
              tab === key
                ? 'rounded-xl border border-[#0D9488] bg-[#0D9488] px-4 py-2 text-xs font-semibold text-white shadow-sm sm:text-sm'
                : 'rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-600 transition-all hover:bg-slate-50 sm:text-sm'
            }
          >
            {t(`referrals.tab${key === 'received' ? 'Received' : 'Sent'}`)}
          </button>
        ))}
      </div>

      {isLoading ? (
        <CenteredSpinner />
      ) : visible.length === 0 ? (
        <div className={CARD}><p className="patient-text-body-secondary" style={{ color: 'var(--text-secondary)' }}>{t('referrals.none')}</p></div>
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map((r) => (
            <div key={r.id} className={CARD}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="patient-text-card-title" style={{ color: 'var(--text-primary)' }}>
                    {r.patient_name} · {t(`referrals.type.${r.referral_type}`)} · <ReferralDestination referral={r} />
                  </h3>
                  <div className="patient-text-body-secondary mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    {tab === 'received' ? r.referring_doctor_name : ''} {formatDate(r.referral_date, language)}
                  </div>
                  {r.reason && <p className="patient-text-body mt-1" style={{ color: 'var(--text-primary)' }}>{r.reason}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold ${REFERRAL_STATUS_BADGE[r.status] ?? REFERRAL_STATUS_BADGE.CANCELLED}`}>
                    {t(`referrals.status.${r.status}`)}
                  </span>
                  {tab === 'received' && r.status === 'PENDING' && (
                    <button type="button" disabled={accept.isPending} onClick={() => accept.mutate(r.id)} className={BTN_PRIMARY}>
                      {accept.isPending && <Spinner size={14} />}{t('referrals.accept')}
                    </button>
                  )}
                  {tab === 'received' && r.status === 'ACCEPTED' && r.accepted_by === myDoctorId && (
                    <button type="button" disabled={complete.isPending} onClick={() => complete.mutate(r.id)} className={BTN_PRIMARY}>
                      {complete.isPending && <Spinner size={14} />}{t('referrals.complete')}
                    </button>
                  )}
                  {tab === 'sent' && (r.status === 'PENDING' || r.status === 'ACCEPTED') && (
                    <button type="button" disabled={cancel.isPending} onClick={() => cancel.mutate(r.id)} className={BTN_DANGER}>
                      {cancel.isPending && <Spinner size={14} />}{t('referrals.cancel')}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
