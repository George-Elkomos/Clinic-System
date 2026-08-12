import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { StarRating } from '../../components/primitives/StarRating'
import { useLanguage } from '../../hooks/useLanguage'
import { formatDate } from '../../lib/format'
import { reviewsApi } from '../../services/reviews.api'

const CARD = 'rounded-2xl border border-[#F3F4F6] bg-white p-5 shadow-sm sm:p-6'

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

function StatLine({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-sm text-slate-600">{label}</span>
      <span className="text-lg font-bold text-slate-900">{value}</span>
    </div>
  )
}

export function DoctorReviewsPage() {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { data: reviews = [], isLoading } = useQuery({ queryKey: ['doctor-reviews'], queryFn: () => reviewsApi.list() })

  const visible = reviews.filter((r) => !r.is_hidden)
  const avg = visible.length
    ? (visible.reduce((s, r) => s + r.rating, 0) / visible.length).toFixed(1)
    : null

  const distribution = [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: visible.filter((r) => r.rating === star).length,
  }))
  const maxCount = Math.max(1, ...distribution.map((d) => d.count))
  const withComments = reviews.filter((r) => r.comment.trim().length > 0).length
  const hiddenCount = reviews.filter((r) => r.is_hidden).length

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Breadcrumbs trail={[{ label: t('reviews.title') }]} />
        <h1 className="patient-text-page-title lg:hidden" style={{ color: 'var(--text-primary)' }}>{t('reviews.title')}</h1>
      </div>

      {isLoading ? (
        <CenteredSpinner />
      ) : (
        <>
          {avg && (
            <div className="grid grid-cols-1 gap-6 rounded-2xl border border-slate-100 bg-white p-6 shadow-sm md:grid-cols-3">
              <div className="flex flex-col items-center justify-center gap-1.5 text-center md:items-start md:text-start">
                <span className="text-4xl font-bold text-slate-900">{avg}</span>
                <StarRating value={Math.round(Number(avg))} readOnly />
                <span className="text-sm text-slate-500">{t('reviews.averageLabel', { avg, count: visible.length })}</span>
              </div>

              <div className="flex flex-col gap-1.5 border-slate-100 md:border-s md:ps-6">
                {distribution.map(({ star, count }) => (
                  <div key={star} className="flex items-center gap-2">
                    <span className="w-10 shrink-0 text-xs font-medium text-slate-500">{star} ★</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-[#0D9488]"
                        style={{ width: `${(count / maxCount) * 100}%` }}
                      />
                    </div>
                    <span className="w-6 shrink-0 text-end text-xs font-medium text-slate-500">{count}</span>
                  </div>
                ))}
              </div>

              <div className="flex flex-col divide-y divide-slate-100 border-slate-100 md:border-s md:ps-6">
                <StatLine label={t('reviews.totalCount')} value={reviews.length} />
                <StatLine label={t('reviews.withCommentsCount')} value={withComments} />
                <StatLine label={t('reviews.hiddenCount')} value={hiddenCount} />
              </div>
            </div>
          )}

          {reviews.length === 0 ? (
            <div className={CARD}><p className="patient-text-body-secondary" style={{ color: 'var(--text-secondary)' }}>{t('reviews.none')}</p></div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {reviews.map((r) => (
                <div key={r.id} className={`flex flex-col gap-3 rounded-2xl border bg-white p-5 shadow-sm ${r.is_hidden ? 'border-slate-200 opacity-70' : 'border-slate-100'}`}>
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#0D9488]/10 text-sm font-semibold text-[#0D9488]">
                      {initials(r.patient_name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-slate-900">{r.patient_name}</div>
                      <span className="inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                        {formatDate(r.created_at, language)}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <StarRating value={r.rating} readOnly />
                    {r.is_hidden && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">{t('reviews.hidden')}</span>
                    )}
                  </div>
                  {r.comment && <p className="text-sm leading-relaxed text-slate-700">{r.comment}</p>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
