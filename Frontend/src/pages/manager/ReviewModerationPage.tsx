import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { useConfirm } from '../../components/primitives/ConfirmDialog'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { StarRating } from '../../components/primitives/StarRating'
import { useToast } from '../../components/primitives/Toast'
import { useLanguage } from '../../hooks/useLanguage'
import { formatDate } from '../../lib/format'
import { errorMessage } from '../../services/apiClient'
import { reviewsApi } from '../../services/reviews.api'

const CARD = 'rounded-2xl border border-[#F3F4F6] bg-white p-5 shadow-sm sm:p-6'
const BTN_SECONDARY = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-all'
const BTN_DANGER = 'inline-flex items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-medium text-rose-600 transition-all hover:bg-rose-100'

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
    <div className="flex flex-col gap-6">
      <div>
        <Breadcrumbs trail={[{ label: t('reviews.moderation') }]} />
        <h1 className="patient-text-page-title lg:hidden" style={{ color: 'var(--text-primary)' }}>{t('reviews.moderation')}</h1>
      </div>
      {isLoading ? (
        <CenteredSpinner />
      ) : reviews.length === 0 ? (
        <div className={CARD}><p className="patient-text-body-secondary" style={{ color: 'var(--text-secondary)' }}>{t('reviews.none')}</p></div>
      ) : (
        <div className="flex flex-col gap-3">
          {reviews.map((r) => (
            <div key={r.id} className={CARD}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <StarRating value={r.rating} readOnly />
                  <div className="patient-text-body-secondary mt-1" style={{ color: 'var(--text-secondary)' }}>
                    {r.doctor_name} · {r.patient_name} · {formatDate(r.created_at, language)}
                    {r.is_hidden ? ` · ${t('reviews.hidden')}` : ''}
                  </div>
                </div>
                {r.is_hidden
                  ? <button type="button" onClick={() => unhide.mutate(r.id)} className={BTN_SECONDARY}>{t('reviews.unhide')}</button>
                  : <button type="button" onClick={() => onHide(r.id)} className={BTN_DANGER}>{t('reviews.hide')}</button>}
              </div>
              {r.comment && <p className="patient-text-body mt-2" style={{ color: 'var(--text-primary)' }}>{r.comment}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
