import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

export interface Crumb { label: string; to?: string }

// Max 2 levels deep (enforces the simple-navigation rule).
export function Breadcrumbs({ trail }: { trail: Crumb[] }) {
  const { t } = useTranslation()
  const items: Crumb[] = [{ label: t('breadcrumbs.home'), to: '/' }, ...trail]
  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      {items.map((c, i) => (
        <Fragment key={i}>
          {i > 0 && <span aria-hidden="true">/</span>}
          {c.to && i < items.length - 1 ? <Link to={c.to}>{c.label}</Link> : <span>{c.label}</span>}
        </Fragment>
      ))}
    </nav>
  )
}
