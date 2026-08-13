import { useQuery } from '@tanstack/react-query'
import { Activity, ClipboardList, FileText, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { useLanguage } from '../../hooks/useLanguage'
import { formatDate } from '../../lib/format'
import { medicalApi } from '../../services/medical.api'

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[#F3F4F6] bg-white p-6 shadow-sm">
      {/* patient-text-h2 (plain CSS), not text-xl — globals.css's unlayered
          `h2 { font-size: var(--font-h2) }` (27px) beats any Tailwind size
          utility here regardless of className. */}
      <h2 className="patient-text-h2 text-slate-800">{title}</h2>
      {children}
    </div>
  )
}

function EmptyState({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <Icon className="mb-2 h-10 w-10 text-slate-300" />
      <p className="text-xs font-medium text-slate-400">{text}</p>
    </div>
  )
}

export function MyMedicalHistoryPage() {
  const { t } = useTranslation()
  const { language } = useLanguage()

  const { data: records = [], isLoading: recordsLoading } = useQuery({ queryKey: ['records', 'mine'], queryFn: () => medicalApi.records() })
  const { data: notes = [], isLoading: notesLoading } = useQuery({ queryKey: ['notes', 'mine'], queryFn: () => medicalApi.notes() })

  if (recordsLoading || notesLoading) return <CenteredSpinner />

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs trail={[{ label: t('nav.medicalHistory') }]} />
      <h1 className="patient-text-page-title" style={{ color: 'var(--text-primary)' }}>
        {t('nav.medicalHistory')}
      </h1>

      <SectionCard title={t('medical.records')}>
        <div className="mt-4">
          {records.length === 0 ? (
            <EmptyState icon={FileText} text={t('medical.noRecords')} />
          ) : (
            <div className="relative">
              {/* Continuous rail behind the version dots — a single absolutely
                  positioned line, not per-row flex-stretch, so it stays
                  unbroken across the gaps between cards. */}
              <div className="absolute bottom-5 left-[5px] top-5 w-px bg-slate-200" aria-hidden="true" />
              <div className="flex flex-col gap-3">
                {records.map((r) => (
                  <div key={r.id} className="relative flex gap-4">
                    <span
                      className={`relative z-10 mt-4 h-2.5 w-2.5 shrink-0 rounded-full ${
                        r.is_current ? 'bg-[#3BC9CB]' : 'bg-slate-300'
                      }`}
                      aria-hidden="true"
                    />
                    <div
                      className={`flex-1 space-y-2 rounded-xl border p-4 shadow-sm ${
                        r.is_current
                          ? 'border-slate-100 border-l-4 border-l-[#3BC9CB] bg-sky-50/30'
                          : 'border-slate-100 bg-white'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-semibold text-sky-700">
                            {t('medical.version', { n: r.version })}
                          </span>
                          {r.is_current && (
                            <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                              {t('medical.current')}
                            </span>
                          )}
                        </div>
                        <span className="text-xs font-medium text-slate-400">
                          {formatDate(r.created_at, language)} · {r.doctor_name}
                        </span>
                      </div>
                      {r.diagnosis && (
                        <div className="flex items-start gap-1.5">
                          <Activity size={13} className="mt-0.5 shrink-0 text-slate-400" />
                          <div>
                            <div className="text-xs font-semibold text-slate-700">{t('medical.diagnosis')}</div>
                            <p className="mt-0.5 text-xs leading-relaxed text-slate-600">{r.diagnosis}</p>
                          </div>
                        </div>
                      )}
                      {r.treatment_plan && (
                        <div className="flex items-start gap-1.5">
                          <ClipboardList size={13} className="mt-0.5 shrink-0 text-slate-400" />
                          <div>
                            <div className="text-xs font-semibold text-slate-700">{t('medical.treatmentPlan')}</div>
                            <p className="mt-0.5 text-xs leading-relaxed text-slate-600">{r.treatment_plan}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </SectionCard>

      <SectionCard title={t('medical.notes')}>
        <div className="mt-4">
          {notes.length === 0 ? (
            <EmptyState icon={FileText} text={t('medical.noNotes')} />
          ) : (
            notes.map((n) => (
              <div key={n.id} className="mb-3 rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
                <div className="text-xs font-medium text-slate-400">
                  {n.specialty_category_name} · {n.doctor_name} · {formatDate(n.created_at, language)}
                </div>
                <div className="mt-1 text-xs leading-relaxed text-slate-600">{n.body}</div>
              </div>
            ))
          )}
        </div>
      </SectionCard>
    </div>
  )
}
