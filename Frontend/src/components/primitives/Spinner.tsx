import { useTranslation } from 'react-i18next'

export function Spinner({ size = 28 }: { size?: number }) {
  const { t } = useTranslation()
  return (
    <span
      className="spinner"
      style={{ width: size, height: size }}
      role="status"
      aria-label={t('common.loading')}
    />
  )
}

export function CenteredSpinner() {
  return (
    <div className="spinner--center">
      <Spinner size={40} />
    </div>
  )
}
