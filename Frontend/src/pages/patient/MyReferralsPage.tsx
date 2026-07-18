import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { Card } from '../../components/primitives/Card'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { StatusBadge } from '../../components/primitives/StatusBadge'
import { useLanguage } from '../../hooks/useLanguage'
import { formatDate, localizedName } from '../../lib/format'
import { referralsApi } from '../../services/referrals.api'
import type { Referral } from '../../services/types'

function ReferralDestination({ referral }: { referral: Referral }) {
  const { t } = useTranslation()
  const { language } = useLanguage()
  if (referral.referral_type === 'EXTERNAL') {
    return <span>{referral.external_facility_name}</span>
  }
  return (
    <span>
      {referral.specialty_detail ? localizedName(referral.specialty_detail, language) : t('referrals.internal')}
      {referral.target_doctor_name && ` · ${referral.target_doctor_name}`}
    </span>
  )
}

export function MyReferralsPage() {
  const { t } = useTranslation()
  const { language } = useLanguage()

  const { data, isLoading } = useQuery({
    queryKey: ['referrals', 'mine'],
    queryFn: () => referralsApi.list(),
  })

  const rows = data?.results ?? []

  return (
    <div>
      <Breadcrumbs trail={[{ label: t('nav.myReferrals') }]} />
      <h1>{t('nav.myReferrals')}</h1>

      {isLoading ? (
        <CenteredSpinner />
      ) : rows.length === 0 ? (
        <Card><p>{t('referrals.none')}</p></Card>
      ) : (
        rows.map((r) => (
          <Card key={r.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              <div>
                <h3 style={{ margin: 0 }}>
                  {t(`referrals.type.${r.referral_type}`)} · <ReferralDestination referral={r} />
                </h3>
                <div style={{ color: 'var(--text-muted)' }}>
                  {r.referring_doctor_name} · {formatDate(r.referral_date, language)}
                </div>
                <p style={{ marginBottom: 0 }}>{r.reason}</p>
              </div>
              <StatusBadge status={r.status} ns="referrals.status" />
            </div>
          </Card>
        ))
      )}
    </div>
  )
}
