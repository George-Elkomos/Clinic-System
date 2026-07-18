import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { Button } from '../../components/primitives/Button'
import { Card } from '../../components/primitives/Card'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { StatusBadge } from '../../components/primitives/StatusBadge'
import { useToast } from '../../components/primitives/Toast'
import { useAuth } from '../../hooks/useAuth'
import { useLanguage } from '../../hooks/useLanguage'
import { formatDate, localizedName } from '../../lib/format'
import { errorMessage } from '../../services/apiClient'
import { referralsApi } from '../../services/referrals.api'
import type { Referral } from '../../services/types'

type Tab = 'received' | 'sent'

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
    <div>
      <Breadcrumbs trail={[{ label: t('nav.referrals') }]} />
      <h1>{t('nav.referrals')}</h1>

      <div className="billing-tabs" role="tablist">
        {(['received', 'sent'] as Tab[]).map((key) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            className={`billing-tabs__tab${tab === key ? ' billing-tabs__tab--active' : ''}`}
            onClick={() => setTab(key)}
          >
            {t(`referrals.tab${key === 'received' ? 'Received' : 'Sent'}`)}
          </button>
        ))}
      </div>

      {isLoading ? (
        <CenteredSpinner />
      ) : visible.length === 0 ? (
        <Card><p>{t('referrals.none')}</p></Card>
      ) : (
        visible.map((r) => (
          <Card key={r.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              <div>
                <h3 style={{ margin: 0 }}>
                  {r.patient_name} · {t(`referrals.type.${r.referral_type}`)} · <ReferralDestination referral={r} />
                </h3>
                <div style={{ color: 'var(--text-muted)' }}>
                  {tab === 'received' ? r.referring_doctor_name : ''} {formatDate(r.referral_date, language)}
                </div>
                <p style={{ marginBottom: 0 }}>{r.reason}</p>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
                <StatusBadge status={r.status} ns="referrals.status" />
                {tab === 'received' && r.status === 'PENDING' && (
                  <Button loading={accept.isPending} onClick={() => accept.mutate(r.id)}>{t('referrals.accept')}</Button>
                )}
                {tab === 'received' && r.status === 'ACCEPTED' && r.accepted_by === myDoctorId && (
                  <Button loading={complete.isPending} onClick={() => complete.mutate(r.id)}>{t('referrals.complete')}</Button>
                )}
                {tab === 'sent' && (r.status === 'PENDING' || r.status === 'ACCEPTED') && (
                  <Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate(r.id)}>{t('referrals.cancel')}</Button>
                )}
              </div>
            </div>
          </Card>
        ))
      )}
    </div>
  )
}
