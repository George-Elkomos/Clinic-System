import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

function ErrorScreen({ title, body }: { title: string; body: string }) {
  const { t } = useTranslation()
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-5)' }}>
      <div className="card" style={{ maxWidth: 480, textAlign: 'center' }}>
        <h1>{title}</h1>
        <p>{body}</p>
        <Link to="/" className="btn btn--primary">{t('errors.goHome')}</Link>
      </div>
    </div>
  )
}

export function ForbiddenPage() {
  const { t } = useTranslation()
  return <ErrorScreen title={t('errors.forbiddenTitle')} body={t('errors.forbiddenBody')} />
}

export function NotFoundPage() {
  const { t } = useTranslation()
  return <ErrorScreen title={t('errors.notFoundTitle')} body={t('errors.notFoundBody')} />
}
