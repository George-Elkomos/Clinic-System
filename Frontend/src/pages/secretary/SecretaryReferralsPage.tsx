import { useQuery } from '@tanstack/react-query'
import { Share2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { useLanguage } from '../../hooks/useLanguage'
import { formatDate, localizedName } from '../../lib/format'
import { referralsApi } from '../../services/referrals.api'
import type { Referral, ReferralStatus } from '../../services/types'

const REFERRAL_BADGE: Record<ReferralStatus, string> = {
  COMPLETED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  ACCEPTED: 'bg-sky-50 text-sky-700 border-sky-200',
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  CANCELLED: 'bg-slate-100 text-slate-500 border-slate-200',
}

function ReferralBadge({ status }: { status: ReferralStatus }) {
  const { t } = useTranslation()
  return (
    <span className={`inline-flex w-fit shrink-0 items-center rounded-full border px-3 py-1 text-xs font-bold ${REFERRAL_BADGE[status] ?? REFERRAL_BADGE.CANCELLED}`}>
      {t(`referrals.status.${status}`)}
    </span>
  )
}

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

function MetaField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-semibold text-slate-400">{label}</div>
      <div className="mt-0.5 text-sm font-medium text-slate-700">{value}</div>
    </div>
  )
}

function ReferralCard({ r }: { r: Referral }) {
  const { t } = useTranslation()
  const { language } = useLanguage()

  return (
    <div className="mb-4 rounded-2xl border border-slate-100 bg-white p-5 shadow-sm transition-all hover:shadow-md sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <span className="rounded-md bg-[#0D9488]/10 px-2.5 py-1 text-xs font-semibold text-[#0D9488]">
            {t(`referrals.type.${r.referral_type}`)}
          </span>
          <span className="text-base font-bold text-slate-800">
            {r.patient_name} · <ReferralDestination referral={r} />
          </span>
        </div>
        <ReferralBadge status={r.status} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetaField label={t('referrals.referringDoctorLabel')} value={r.referring_doctor_name} />
        <MetaField label={t('referrals.dateLabel')} value={formatDate(r.referral_date, language)} />
      </div>
    </div>
  )
}

function EmptyReferralsState() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-100 bg-white px-6 py-16 text-center shadow-sm">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#0D9488]/10 text-[#0D9488]">
        <Share2 className="h-7 w-7" aria-hidden="true" />
      </div>
      <div className="text-base font-bold text-slate-800">{t('referrals.none')}</div>
    </div>
  )
}

// Read-only, clinic-wide referral list for the front desk — enough to chase
// up scheduling (who, status, where they're headed) but no clinical reason/
// notes text, which the API never sends this role in the first place.
export function SecretaryReferralsPage() {
  const { t } = useTranslation()

  const { data, isLoading } = useQuery({
    queryKey: ['referrals', 'desk'],
    queryFn: () => referralsApi.list(),
  })

  const rows = data?.results ?? []

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Breadcrumbs trail={[{ label: t('nav.referrals') }]} />
        <h1 className="patient-text-page-title lg:hidden" style={{ color: 'var(--text-primary)' }}>{t('nav.referrals')}</h1>
      </div>

      {isLoading ? (
        <CenteredSpinner />
      ) : rows.length === 0 ? (
        <EmptyReferralsState />
      ) : (
        rows.map((r) => <ReferralCard key={r.id} r={r} />)
      )}
    </div>
  )
}
