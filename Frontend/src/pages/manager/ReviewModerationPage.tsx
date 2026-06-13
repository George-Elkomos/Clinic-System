import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { Button } from '../../components/primitives/Button'
import { Card } from '../../components/primitives/Card'
import { useConfirm } from '../../components/primitives/ConfirmDialog'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { StarRating } from '../../components/primitives/StarRating'
import { useToast } from '../../components/primitives/Toast'
import { useLanguage } from '../../hooks/useLanguage'
import { formatDate } from '../../lib/format'
import { errorMessage } from '../../services/apiClient'
import { reviewsApi } from '../../services/reviews.api'

export function ReviewModerationPage() {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const qc = useQueryClient()

  const { data: reviews = [], isLoading } = useQuery({ queryKey: ['all-reviews'], queryFn: () => reviewsApi.list() })

  const hide = useMutation({
    mutationFn: (id: number) => reviewsApi.hide(id, ''),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['all-reviews'] }),
    onError: (err) => showToast(errorMessage(err), 'error'),
  })
  const unhide = useMutation({
    mutationFn: (id: number) => reviewsApi.unhide(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['all-reviews'] }),
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const onHide = async (id: number) => {
    if (await confirm({ title: t('reviews.hide'), message: t('reviews.hideConfirm'), danger: true })) hide.mutate(id)
  }

  return (
    <div>
      <Breadcrumbs trail={[{ label: t('reviews.moderation') }]} />
      <h1>{t('reviews.moderation')}</h1>
      {isLoading ? (
        <CenteredSpinner />
      ) : reviews.length === 0 ? (
        <Card><p>{t('reviews.none')}</p></Card>
      ) : (
        reviews.map((r) => (
          <Card key={r.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
              <div>
                <StarRating value={r.rating} readOnly />
                <div style={{ color: 'var(--text-muted)' }}>
                  {r.doctor_name} · {r.patient_name} · {formatDate(r.created_at, language)}
                  {r.is_hidden ? ` · ${t('reviews.hidden')}` : ''}
                </div>
              </div>
              {r.is_hidden
                ? <Button variant="secondary" onClick={() => unhide.mutate(r.id)}>{t('reviews.unhide')}</Button>
                : <Button variant="danger" onClick={() => onHide(r.id)}>{t('reviews.hide')}</Button>}
            </div>
            {r.comment && <p style={{ marginTop: 'var(--space-2)' }}>{r.comment}</p>}
          </Card>
        ))
      )}
    </div>
  )
}
