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
import { formatDate, formatDateTime } from '../../lib/format'
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

// "room_number" -> "Room Number" — the backend diff stores raw Python field names.
function humanizeField(field: string): string {
  return field.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

interface ChecklistStep {
  step: string
  required?: boolean
  completed?: boolean
}

// ClinicalProcedure.checklist_state's shape: [{step, required, completed}, ...].
// Detect it structurally (rather than by field name) so any future JSONField
// shaped like this also gets the readable per-step summary for free.
function isChecklistArray(value: unknown): value is ChecklistStep[] {
  return Array.isArray(value) && value.length > 0 && value.every((v) => v && typeof v === 'object' && typeof (v as ChecklistStep).step === 'string')
}

type ChecklistDiffLine = { type: 'added' | 'removed' | 'completed' | 'unchecked'; step: string }

// Matches steps by their text (stable across edits) rather than array index,
// so a step inserted in the middle doesn't make every step after it look changed.
function diffChecklist(oldList: ChecklistStep[], newList: ChecklistStep[]): ChecklistDiffLine[] {
  const oldMap = new Map(oldList.map((s) => [s.step, s]))
  const newMap = new Map(newList.map((s) => [s.step, s]))
  const lines: ChecklistDiffLine[] = []
  newMap.forEach((newStep, step) => {
    const oldStep = oldMap.get(step)
    if (!oldStep) lines.push({ type: 'added', step })
    else if (!!oldStep.completed !== !!newStep.completed) {
      lines.push({ type: newStep.completed ? 'completed' : 'unchecked', step })
    }
  })
  oldMap.forEach((_, step) => {
    if (!newMap.has(step)) lines.push({ type: 'removed', step })
  })
  return lines
}

// Any other array/object field (present or future): render as clean bullets
// instead of dumping String(value) (which for objects/arrays of objects is
// either "[object Object]" or, coming from the backend's old str()-repr path,
// an unreadable single-quoted Python dump).
function formatGenericItem(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${humanizeField(k)}: ${v === null || v === undefined || v === '' ? '—' : String(v)}`)
      .join(', ')
  }
  return String(value)
}

// The backend diffs dates/datetimes via Python's str(value) (e.g.
// "2026-08-01 16:58:37.349229+00:00"), not DRF's serializer — so unlike
// e.timestamp, these never went through a locale-aware formatter.
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/
const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/

export function AuditLogPage() {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const [search, setSearch] = useState('')
  const [action, setAction] = useState('')

  // Backend diff values are already real null/boolean/string/number (see
  // apps/audit/signals.py's _serialize) — render them for a non-technical reader
  // instead of the raw `String(null)` -> "null" / `String(false)` -> "false".
  const formatDiffValue = (value: unknown) => {
    if (value === null || value === undefined || value === '') return t('common.none')
    if (typeof value === 'boolean') return value ? t('common.yes') : t('common.no')
    if (typeof value === 'string') {
      if (DATE_TIME_RE.test(value)) return formatDateTime(value, language)
      if (DATE_ONLY_RE.test(value)) return formatDate(value, language)
    }
    return String(value)
  }

  // One side (old or new) of a non-checklist array/object diff: empty array,
  // populated array, plain dict, or a bare scalar (null/primitive) each need
  // different rendering.
  const renderComplexSide = (value: unknown) => {
    if (Array.isArray(value)) {
      if (value.length === 0) return <span className="audit-diff-item__old">{t('common.none')}</span>
      return <ul>{value.map((v, i) => <li key={i}>{formatGenericItem(v)}</li>)}</ul>
    }
    if (typeof value === 'object' && value !== null) {
      return <ul><li>{formatGenericItem(value)}</li></ul>
    }
    return <span>{formatDiffValue(value)}</span>
  }

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
        <div className="filter-bar">
          <div className="filter-bar__field audit-filter__search">
            <SearchInput onSearch={setSearch} placeholder={t('audit.searchPlaceholder')} />
          </div>
          <div className="filter-bar__field">
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
            <div className="audit-card__header">
              <strong className="audit-card__title">{e.action_display} · {e.model_name}</strong>
              <span className="audit-card__time">{formatDateTime(e.timestamp, language)}</span>
            </div>
            <div className="audit-card__meta">
              {t('audit.actor')}: <span className="audit-card__meta-value">{e.actor_email ?? t('common.none')}</span>
              {' · '}
              {t('audit.object')}: <span className="audit-card__meta-value">{e.object_repr}</span>
            </div>
            {Object.keys(e.changes || {}).length > 0 && (
              <div className="audit-changes">
                <h4 className="audit-changes__heading">{t('audit.changes')}</h4>
                {Object.entries(e.changes).map(([field, diff]) => {
                  if (isChecklistArray(diff.old) || isChecklistArray(diff.new)) {
                    const lines = diffChecklist(
                      Array.isArray(diff.old) ? (diff.old as ChecklistStep[]) : [],
                      Array.isArray(diff.new) ? (diff.new as ChecklistStep[]) : [],
                    )
                    return (
                      <div key={field} className="audit-diff-item audit-diff-item--list">
                        <span className="audit-diff-item__field">{humanizeField(field)}</span>
                        {lines.length === 0 ? (
                          <span className="audit-diff-item__note">{t('audit.checklistNoStepChange')}</span>
                        ) : (
                          <ul className="audit-diff-checklist">
                            {lines.map((line, i) => (
                              <li key={i} className={`audit-diff-checklist__line audit-diff-checklist__line--${line.type}`}>
                                {t(`audit.checklist${line.type.charAt(0).toUpperCase()}${line.type.slice(1)}`, { step: line.step })}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )
                  }

                  const isComplex = Array.isArray(diff.old) || Array.isArray(diff.new)
                    || (typeof diff.old === 'object' && diff.old !== null) || (typeof diff.new === 'object' && diff.new !== null)
                  if (isComplex) {
                    return (
                      <div key={field} className="audit-diff-item audit-diff-item--list">
                        <span className="audit-diff-item__field">{humanizeField(field)}</span>
                        <div className="audit-diff-generic">
                          <div className="audit-diff-generic__col">
                            <span className="audit-diff-generic__label">{t('audit.before')}</span>
                            {renderComplexSide(diff.old)}
                          </div>
                          <div className="audit-diff-generic__col">
                            <span className="audit-diff-generic__label">{t('audit.after')}</span>
                            {renderComplexSide(diff.new)}
                          </div>
                        </div>
                      </div>
                    )
                  }

                  return (
                    <div key={field} className="audit-diff-item">
                      <span className="audit-diff-item__field">{humanizeField(field)}</span>
                      <span className="audit-diff-item__old">{formatDiffValue(diff.old)}</span>
                      <span className="audit-diff-item__arrow">→</span>
                      <span className="audit-diff-item__new">{formatDiffValue(diff.new)}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </Card>
        ))
      )}
    </div>
  )
}
