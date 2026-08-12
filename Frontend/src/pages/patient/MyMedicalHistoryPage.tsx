import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, AlertTriangle, ClipboardList, Droplets, FileText, Pill, Scissors, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { Select } from '../../components/primitives/Select'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { useToast } from '../../components/primitives/Toast'
import { useLanguage } from '../../hooks/useLanguage'
import { formatDate } from '../../lib/format'
import { errorMessage } from '../../services/apiClient'
import { authApi } from '../../services/auth.api'
import { medicalApi } from '../../services/medical.api'
import type { PatientProfile } from '../../services/types'

// Plain CSS class, not Tailwind utilities — globals.css sets
// input/select/textarea border/radius/background/color/padding as unlayered
// plain CSS, which silently beats Tailwind's (always-layered) utilities for
// those same properties regardless of className. See patient-field in
// patient-tokens.css.
const FIELD_CLASS = 'patient-field'
const TEXTAREA_CLASS = `${FIELD_CLASS} resize-none`

const BLOOD_OPTIONS = ['', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((value) => ({
  value,
  label: value || '-',
}))

function FieldLabel({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <span className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-slate-700">
      <Icon size={15} className="text-slate-400" />
      {text}
    </span>
  )
}

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

// Initialized from the loaded profile (mounted only once data is present), so no
// state-syncing effect is needed.
function BackgroundForm({ initial }: { initial: PatientProfile }) {
  const { t } = useTranslation()
  const { showToast } = useToast()
  const qc = useQueryClient()
  const [form, setForm] = useState({
    blood_type: initial.blood_type ?? '',
    allergies_summary: initial.allergies_summary ?? '',
    chronic_conditions: initial.chronic_conditions ?? '',
    previous_surgeries: initial.previous_surgeries ?? '',
    current_medications: initial.current_medications ?? '',
  })

  const save = useMutation({
    mutationFn: () => authApi.updatePatientProfile(form as Partial<PatientProfile>),
    onSuccess: () => {
      showToast(t('medical.backgroundSaved'), 'success')
      qc.invalidateQueries({ queryKey: ['patient-profile'] })
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  return (
    <SectionCard title={t('medical.background')}>
      {/* globals.css's unlayered `p { margin: 0 0 var(--space-3) }` forces
          margin-top:0 regardless of a mt-* class, so this goes inline instead. */}
      <p className="text-sm text-slate-500" style={{ marginTop: '0.25rem' }}>{t('medical.backgroundIntro')}</p>

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* A plain <div>, not <label> — wrapping <Select> in a bare <label> makes the
            browser's implicit label-activation fire a phantom second click on whatever
            labelable element (e.g. the "×" clear button) appears inside it right after
            a selection, which immediately re-clears the value. FormField-driven Selects
            elsewhere avoid this because their <label> is a sibling with htmlFor, not a wrapper. */}
        <div className="flex flex-col">
          <FieldLabel icon={Droplets} text={t('medical.bloodType')} />
          <Select
            options={BLOOD_OPTIONS}
            value={form.blood_type}
            onChange={(value) => setForm((f) => ({ ...f, blood_type: String(value) }))}
          />
        </div>
        <label className="flex flex-col">
          <FieldLabel icon={AlertTriangle} text={t('medical.allergies')} />
          <textarea rows={2} className={TEXTAREA_CLASS} value={form.allergies_summary} onChange={set('allergies_summary')} />
        </label>
        <label className="flex flex-col">
          <FieldLabel icon={Activity} text={t('medical.chronicConditions')} />
          <textarea rows={2} className={TEXTAREA_CLASS} value={form.chronic_conditions} onChange={set('chronic_conditions')} />
        </label>
        <label className="flex flex-col">
          <FieldLabel icon={Pill} text={t('medical.currentMedications')} />
          <textarea rows={2} className={TEXTAREA_CLASS} value={form.current_medications} onChange={set('current_medications')} />
        </label>
        <label className="flex flex-col sm:col-span-2">
          <FieldLabel icon={Scissors} text={t('medical.previousSurgeries')} />
          <textarea rows={2} className={TEXTAREA_CLASS} value={form.previous_surgeries} onChange={set('previous_surgeries')} />
        </label>
      </div>

      <div className="mt-5 flex justify-end">
        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="rounded-xl bg-[#0D9488] border border-[#0B7A70] px-6 py-2.5 font-semibold text-white shadow-sm transition-all hover:bg-[#0B7A70] disabled:opacity-60"
        >
          {t('medical.saveBackground')}
        </button>
      </div>
    </SectionCard>
  )
}

export function MyMedicalHistoryPage() {
  const { t } = useTranslation()
  const { language } = useLanguage()

  const { data: profile, isLoading } = useQuery({
    queryKey: ['patient-profile'],
    queryFn: authApi.patientProfile,
  })
  const { data: records = [] } = useQuery({ queryKey: ['records', 'mine'], queryFn: () => medicalApi.records() })
  const { data: notes = [] } = useQuery({ queryKey: ['notes', 'mine'], queryFn: () => medicalApi.notes() })

  if (isLoading || !profile) return <CenteredSpinner />

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs trail={[{ label: t('nav.medicalHistory') }]} />
      <h1 className="patient-text-page-title" style={{ color: 'var(--text-primary)' }}>
        {t('nav.medicalHistory')}
      </h1>

      <BackgroundForm initial={profile} />

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
