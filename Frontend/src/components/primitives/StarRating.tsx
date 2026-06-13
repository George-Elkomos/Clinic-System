import { useTranslation } from 'react-i18next'

interface StarRatingProps {
  value: number
  max?: number
  onChange?: (value: number) => void  // interactive when provided
  readOnly?: boolean
}

export function StarRating({ value, max = 5, onChange, readOnly = false }: StarRatingProps) {
  const { t } = useTranslation()
  const interactive = !!onChange && !readOnly
  const stars = Array.from({ length: max }, (_, i) => i + 1)

  return (
    <span className="stars" role={interactive ? 'radiogroup' : 'img'}
          aria-label={t('reviews.ratingLabel', { value, max })}>
      {stars.map((n) => {
        const on = n <= value
        const cls = `star ${on ? 'star--on' : ''} ${interactive ? 'star--interactive' : ''}`.trim()
        if (interactive) {
          return (
            <button key={n} type="button" className={cls}
                    aria-label={t('reviews.starLabel', { n })} aria-pressed={on}
                    onClick={() => onChange!(n)}>
              ★
            </button>
          )
        }
        return <span key={n} className={cls} aria-hidden="true">★</span>
      })}
    </span>
  )
}
