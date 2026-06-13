import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { Card } from '../../components/primitives/Card'
import { FormField } from '../../components/primitives/FormField'
import { SearchInput } from '../../components/primitives/SearchInput'
import { Select } from '../../components/primitives/Select'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { useLanguage } from '../../hooks/useLanguage'
import { formatDateTime } from '../../lib/format'
import { api } from '../../services/apiClient'
import type { Paginated } from '../../services/types'

interface AuditEntry {
  id: number
  actor_email: string | null
  actor_name: string
  action: string
  action_display: string
  model_name: string
  object_repr: string
  changes: Record<string, { old: unknown; new: unknown }>
  timestamp: string
}

const ACTIONS = ['CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'ACCESS']

export function AuditLogPage() {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const [search, setSearch] = useState('')
  const [action, setAction] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['audit', search, action],
    queryFn: () =>
      api
        .get<Paginated<AuditEntry>>('/audit-logs/', {
          params: { search: search || undefined, action: action || undefined },
        })
        .then((r) => r.data),
  })

  const rows = data?.results ?? []

  return (
    <div>
      <Breadcrumbs trail={[{ label: t('audit.title') }]} />
      <h1>{t('audit.title')}</h1>

      <Card>
        <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
          <div style={{ flex: 2, minWidth: 220 }}>
            <SearchInput onSearch={setSearch} placeholder={t('audit.searchPlaceholder')} />
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <FormField label={t('audit.filterAction')}>
              {(p) => (
                <Select
                  id={p.id}
                  options={[
                    { value: '', label: t('appointments.filterAll') },
                    ...ACTIONS.map((a) => ({ value: a, label: a })),
                  ]}
                  value={action}
                  onChange={(v) => setAction(Array.isArray(v) ? '' : String(v))}
                />
              )}
            </FormField>
          </div>
        </div>
      </Card>

      {isLoading ? (
        <CenteredSpinner />
      ) : rows.length === 0 ? (
        <Card><p>{t('audit.none')}</p></Card>
      ) : (
        rows.map((e) => (
          <Card key={e.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
              <strong>{e.action_display} · {e.model_name}</strong>
              <span style={{ color: 'var(--text-muted)' }}>{formatDateTime(e.timestamp, language)}</span>
            </div>
            <div>{t('audit.actor')}: {e.actor_email ?? t('common.none')} · {t('audit.object')}: {e.object_repr}</div>
            {Object.keys(e.changes || {}).length > 0 && (
              <div style={{ marginTop: 'var(--space-2)', color: 'var(--text-muted)', fontSize: 'var(--font-small)' }}>
                {Object.entries(e.changes).map(([field, diff]) => (
                  <div key={field}>
                    {field}: <em>{String(diff.old)}</em> → <strong>{String(diff.new)}</strong>
                  </div>
                ))}
              </div>
            )}
          </Card>
        ))
      )}
    </div>
  )
}
