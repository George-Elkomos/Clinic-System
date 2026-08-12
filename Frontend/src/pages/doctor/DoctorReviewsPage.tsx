import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { StarRating } from '../../components/primitives/StarRating'
import { useLanguage } from '../../hooks/useLanguage'
import { formatDate } from '../../lib/format'
import { reviewsApi } from '../../services/reviews.api'

const CARD = 'rounded-2xl border border-[#F3F4F6] bg-white p-5 shadow-sm sm:p-6'

export function DoctorReviewsPage() {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { data: reviews = [], isLoading } = useQuery({ queryKey: ['doctor-reviews'], queryFn: () => reviewsApi.list() })

  const visible = reviews.filter((r) => !r.is_hidden)
  const avg = visible.length
    ? (visible.reduce((s, r) => s + r.rating, 0) / visible.length).toFixed(1)
    : null

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
            <div className={CARD}>
              <div className="flex flex-wrap items-center gap-3">
                <StarRating value={Math.round(Number(avg))} readOnly />
                <strong className="patient-text-body" style={{ color: 'var(--text-primary)' }}>
                  {t('reviews.averageLabel', { avg, count: visible.length })}
                </strong>
              </div>
            </div>
          )}
          {reviews.length === 0 ? (
            <div className={CARD}><p className="patient-text-body-secondary" style={{ color: 'var(--text-secondary)' }}>{t('reviews.none')}</p></div>
          ) : (
            <div className="flex flex-col gap-3">
              {reviews.map((r) => (
                <div key={r.id} className={CARD}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <StarRating value={r.rating} readOnly />
                    <span className="patient-text-body-secondary" style={{ color: 'var(--text-muted)' }}>
                      {formatDate(r.created_at, language)}{r.is_hidden ? ` · ${t('reviews.hidden')}` : ''}
                    </span>
                  </div>
                  {r.comment && <p className="patient-text-body mt-2" style={{ color: 'var(--text-primary)' }}>{r.comment}</p>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
