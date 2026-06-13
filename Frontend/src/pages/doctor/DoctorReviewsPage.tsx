import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { Card } from '../../components/primitives/Card'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { StarRating } from '../../components/primitives/StarRating'
import { useLanguage } from '../../hooks/useLanguage'
import { formatDate } from '../../lib/format'
import { reviewsApi } from '../../services/reviews.api'

export function DoctorReviewsPage() {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { data: reviews = [], isLoading } = useQuery({ queryKey: ['doctor-reviews'], queryFn: () => reviewsApi.list() })

  const visible = reviews.filter((r) => !r.is_hidden)
  const avg = visible.length
    ? (visible.reduce((s, r) => s + r.rating, 0) / visible.length).toFixed(1)
    : null

  return (
    <div>
      <Breadcrumbs trail={[{ label: t('reviews.title') }]} />
      <h1>{t('reviews.title')}</h1>

      {isLoading ? (
        <CenteredSpinner />
      ) : (
        <>
          {avg && (
            <Card>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                <StarRating value={Math.round(Number(avg))} readOnly />
                <strong>{t('reviews.averageLabel', { avg, count: visible.length })}</strong>
              </div>
            </Card>
          )}
          {reviews.length === 0 ? (
            <Card><p>{t('reviews.none')}</p></Card>
          ) : (
            reviews.map((r) => (
              <Card key={r.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                  <StarRating value={r.rating} readOnly />
                  <span style={{ color: 'var(--text-muted)' }}>
                    {formatDate(r.created_at, language)}{r.is_hidden ? ` · ${t('reviews.hidden')}` : ''}
                  </span>
                </div>
                {r.comment && <p style={{ marginTop: 'var(--space-2)' }}>{r.comment}</p>}
              </Card>
            ))
          )}
        </>
      )}
    </div>
  )
}
