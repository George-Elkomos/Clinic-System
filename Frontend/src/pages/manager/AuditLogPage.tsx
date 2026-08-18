import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
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
const CARD = 'rounded-2xl border border-[#F3F4F6] bg-white p-5 shadow-sm sm:p-6'
const ENTRY_CARD = 'space-y-2 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm transition-all hover:border-slate-200'

const ACTION_BADGE: Record<string, string> = {
  CREATE: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  UPDATE: 'bg-blue-50 text-blue-700 border border-blue-200',
  DELETE: 'bg-rose-50 text-rose-700 border border-rose-200',
  ACCESS: 'bg-slate-100 text-slate-700 border border-slate-200',
  READ: 'bg-slate-100 text-slate-700 border border-slate-200',
  LOGIN: 'bg-sky-50 text-sky-700 border border-sky-200',
  LOGOUT: 'bg-slate-100 text-slate-700 border border-slate-200',
}

function ActionBadge({ action, text }: { action: string; text: string }) {
  return (
    <span className={`shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-medium ${ACTION_BADGE[action] ?? ACTION_BADGE.ACCESS}`}>
      {text}
    </span>
  )
}

const CHECKLIST_LINE_STYLE: Record<string, string> = {
  added: 'text-sky-600',
  removed: 'text-rose-500 line-through',
  completed: 'text-emerald-600',
  unchecked: 'text-amber-600',
}

// "room_number" -> "Room Number" — the backend diff stores raw Python field names.
// Used as a last-resort fallback for any field not yet in audit.fields.*.
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
function formatGenericItem(value: unknown, translateField: (field: string) => string): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${translateField(k)}: ${v === null || v === undefined || v === '' ? '—' : String(v)}`)
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

  const translateField = (field: string) =>
    t(`audit.fields.${field}`, { defaultValue: humanizeField(field) })
  const translateModel = (modelName: string) =>
    t(`audit.models.${modelName}`, { defaultValue: modelName })
  const translateAction = (actionCode: string, fallback: string) =>
    t(`audit.actions.${actionCode}`, { defaultValue: fallback })

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
      if (value.length === 0) return <span className="text-slate-400">{t('common.none')}</span>
      return <ul className="list-disc space-y-0.5 ps-4">{value.map((v, i) => <li key={i}>{formatGenericItem(v, translateField)}</li>)}</ul>
    }
    if (typeof value === 'object' && value !== null) {
      return <ul className="list-disc space-y-0.5 ps-4"><li>{formatGenericItem(value, translateField)}</li></ul>
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
    <div className="flex flex-col gap-6">
      <div>
        <Breadcrumbs trail={[{ label: t('audit.title') }]} />
        <h1 className="patient-text-page-title lg:hidden" style={{ color: 'var(--text-primary)' }}>{t('audit.title')}</h1>
      </div>

      <div className="mb-6 flex flex-col items-stretch justify-between gap-4 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm sm:flex-row sm:items-end">
        <div className="field flex-1">
          <label className="field__label">{t('audit.searchLabel')}</label>
          <SearchInput onSearch={setSearch} placeholder={t('audit.searchPlaceholder')} />
        </div>
        <div className="w-full sm:w-56">
          <FormField label={t('audit.filterAction')}>
            {(p) => (
              <Select
                id={p.id}
                options={[
                  { value: '', label: t('appointments.filterAll') },
                  ...ACTIONS.map((a) => ({ value: a, label: translateAction(a, a) })),
                ]}
                value={action}
                onChange={(v) => setAction(Array.isArray(v) ? '' : String(v))}
              />
            )}
          </FormField>
        </div>
      </div>

      {isLoading ? (
        <CenteredSpinner />
      ) : rows.length === 0 ? (
        <div className={CARD}><p className="patient-text-body-secondary" style={{ color: 'var(--text-secondary)' }}>{t('audit.none')}</p></div>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((e) => (
            <div key={e.id} className={ENTRY_CARD}>
              <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
                <div className="flex flex-wrap items-center gap-3">
                  <ActionBadge action={e.action} text={translateAction(e.action, e.action_display)} />
                  <span className="patient-text-card-title" style={{ color: 'var(--text-primary)' }}>{translateModel(e.model_name)}</span>
                </div>
                <span className="shrink-0 text-xs font-medium text-slate-500">{formatDateTime(e.timestamp, language)}</span>
              </div>
              <div className="text-sm">
                <span className="text-slate-500">{t('audit.actor')}:</span> <span className="font-medium text-slate-800">{e.actor_email || t('audit.systemActor')}</span>
                <span className="text-slate-500"> · {t('audit.object')}:</span> <span className="font-medium text-slate-800">{e.object_repr || t('common.none')}</span>
              </div>
              {Object.keys(e.changes || {}).length > 0 && (
                <div className="flex flex-col gap-2 border-t border-slate-100 pt-3">
                  <h4 className="patient-text-overline" style={{ color: 'var(--text-muted)' }}>{t('audit.changes')}</h4>
                  {Object.entries(e.changes).map(([field, diff]) => {
                    if (isChecklistArray(diff.old) || isChecklistArray(diff.new)) {
                      const lines = diffChecklist(
                        Array.isArray(diff.old) ? (diff.old as ChecklistStep[]) : [],
                        Array.isArray(diff.new) ? (diff.new as ChecklistStep[]) : [],
                      )
                      return (
                        <div key={field} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                          <span className="patient-text-body font-semibold" style={{ color: 'var(--text-primary)' }}>{translateField(field)}</span>
                          {lines.length === 0 ? (
                            <span className="patient-text-body-secondary ms-2" style={{ color: 'var(--text-muted)' }}>{t('audit.checklistNoStepChange')}</span>
                          ) : (
                            <ul className="mt-1.5 flex flex-col gap-1">
                              {lines.map((line, i) => (
                                <li key={i} className={`patient-text-body-secondary text-xs ${CHECKLIST_LINE_STYLE[line.type]}`}>
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
                        <div key={field} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                          <span className="patient-text-body font-semibold" style={{ color: 'var(--text-primary)' }}>{translateField(field)}</span>
                          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div>
                              <span className="patient-text-overline" style={{ color: 'var(--text-muted)' }}>{t('audit.before')}</span>
                              <div className="patient-text-body-secondary mt-1" style={{ color: 'var(--text-secondary)' }}>{renderComplexSide(diff.old)}</div>
                            </div>
                            <div>
                              <span className="patient-text-overline" style={{ color: 'var(--text-muted)' }}>{t('audit.after')}</span>
                              <div className="patient-text-body-secondary mt-1" style={{ color: 'var(--text-secondary)' }}>{renderComplexSide(diff.new)}</div>
                            </div>
                          </div>
                        </div>
                      )
                    }

                    return (
                      <div key={field} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-100 bg-slate-50/60 p-3 patient-text-body-secondary">
                        <span className="patient-text-body font-semibold" style={{ color: 'var(--text-primary)' }}>{translateField(field)}</span>
                        <span className="text-slate-400 line-through">{formatDiffValue(diff.old)}</span>
                        <span aria-hidden="true" style={{ color: 'var(--text-muted)' }}>→</span>
                        <span className="font-semibold" style={{ color: 'var(--brand-teal-start)' }}>{formatDiffValue(diff.new)}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
