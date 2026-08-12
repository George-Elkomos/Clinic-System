import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Mic, Square, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { aiApi, type AIDraft, type AISession } from '../../services/ai.api'
import { errorMessage } from '../../services/apiClient'
import { FormField } from '../primitives/FormField'
import { Spinner } from '../primitives/Spinner'
import { useToast } from '../primitives/Toast'

const PROCESSING: AISession['status'][] = ['PENDING', 'TRANSCRIBING', 'EXTRACTING']

const EMPTY_RX = { drug_name: '', dosage: '', frequency: '', duration: '', instructions: '' }

const CARD = 'rounded-2xl border border-[#F3F4F6] bg-white p-5 shadow-sm sm:p-6'
const BTN_PRIMARY = 'inline-flex items-center justify-center gap-2 rounded-xl bg-teal-600 px-5 py-2.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-teal-700 disabled:opacity-60 sm:text-sm'
const BTN_SECONDARY = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-all disabled:opacity-60 sm:text-sm'
const SECTION_DIVIDER = 'patient-text-card-title mb-3 mt-5 border-t border-slate-100 pt-4 first:mt-0 first:border-t-0 first:pt-0'

function mmss(total: number) {
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

// Small pulsing dot used on the record/stop controls to signal a live, active state.
function PulseDot() {
  return (
    <span className="relative flex h-2 w-2">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/70" aria-hidden="true" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-white" aria-hidden="true" />
    </span>
  )
}

export function AIScribePanel({ patientId }: { patientId: number }) {
  const { t } = useTranslation()
  const { showToast } = useToast()
  const qc = useQueryClient()

  const [sessionId, setSessionId] = useState<number | null>(null)
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [draft, setDraft] = useState<AIDraft | null>(null)
  const [showTranscript, setShowTranscript] = useState(false)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<number | null>(null)

  // Poll the session while it is being processed.
  const { data: session } = useQuery({
    queryKey: ['ai-session', sessionId],
    queryFn: () => aiApi.getSession(sessionId as number),
    enabled: sessionId != null,
    refetchInterval: (q) =>
      q.state.data && PROCESSING.includes(q.state.data.status) ? 2500 : false,
  })

  // When a draft becomes available, copy it into editable local state once.
  useEffect(() => {
    if (session?.status === 'READY' && draft === null) {
      setDraft(session.extracted)
    }
  }, [session, draft])

  const upload = useMutation({
    mutationFn: (form: FormData) => aiApi.uploadSession(form),
    onSuccess: (s) => {
      setSessionId(s.id)
      setDraft(null)
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const commit = useMutation({
    mutationFn: () => aiApi.commit(sessionId as number, draft as AIDraft),
    onSuccess: () => {
      showToast(t('ai.committed'), 'success')
      qc.invalidateQueries({ queryKey: ['records', patientId] })
      qc.invalidateQueries({ queryKey: ['prescriptions', patientId] })
      qc.invalidateQueries({ queryKey: ['ai-session', sessionId] })
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const retry = useMutation({
    mutationFn: () => aiApi.retry(sessionId as number),
    onSuccess: (s) => {
      setDraft(null)
      qc.setQueryData(['ai-session', sessionId], s)
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  function uploadBlob(blob: Blob, filename: string) {
    const form = new FormData()
    form.append('patient', String(patientId))
    form.append('audio', blob, filename)
    upload.mutate(form)
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      chunksRef.current = []
      mr.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data)
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' })
        stream.getTracks().forEach((tr) => tr.stop())
        uploadBlob(blob, 'session.webm')
      }
      recorderRef.current = mr
      mr.start()
      setRecording(true)
      setElapsed(0)
      timerRef.current = window.setInterval(() => setElapsed((e) => e + 1), 1000)
    } catch {
      showToast(t('ai.micDenied'), 'error')
    }
  }

  function stopRecording() {
    recorderRef.current?.stop()
    recorderRef.current = null
    setRecording(false)
    if (timerRef.current) window.clearInterval(timerRef.current)
  }

  // Clean up the timer if the component unmounts mid-recording.
  useEffect(() => () => {
    if (timerRef.current) window.clearInterval(timerRef.current)
  }, [])

  function reset() {
    setSessionId(null)
    setDraft(null)
    setShowTranscript(false)
  }

  // ---- draft editing helpers ----
  const setField = (k: keyof AIDraft, v: string) =>
    setDraft((d) => (d ? { ...d, [k]: v } : d))
  const setVital = (k: keyof AIDraft['vitals'], v: string) =>
    setDraft((d) => (d ? { ...d, vitals: { ...d.vitals, [k]: v } } : d))
  const setRx = (i: number, k: keyof typeof EMPTY_RX, v: string) =>
    setDraft((d) =>
      d ? { ...d, prescriptions: d.prescriptions.map((p, idx) => (idx === i ? { ...p, [k]: v } : p)) } : d,
    )
  const addRx = () =>
    setDraft((d) => (d ? { ...d, prescriptions: [...d.prescriptions, { ...EMPTY_RX }] } : d))
  const removeRx = (i: number) =>
    setDraft((d) => (d ? { ...d, prescriptions: d.prescriptions.filter((_, idx) => idx !== i) } : d))

  const status = session?.status
  const busy = upload.isPending || (status && PROCESSING.includes(status))
  const committed = status === 'COMMITTED'

  return (
    <div className={CARD}>
      <h2 className="patient-text-card-title" style={{ color: 'var(--text-primary)' }}>{t('ai.title')}</h2>
      <p className="mt-1 text-sm font-normal leading-relaxed text-slate-600">{t('ai.intro')}</p>

      {/* ---- Capture controls (hidden once a session is in flight) ---- */}
      {!sessionId && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {!recording ? (
            <button
              type="button"
              onClick={startRecording}
              disabled={upload.isPending}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-60"
            >
              <PulseDot />
              <Mic className="h-4 w-4" aria-hidden="true" />
              {t('ai.record')}
            </button>
          ) : (
            <button
              type="button"
              onClick={stopRecording}
              className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-rose-700"
            >
              <PulseDot />
              <Square className="h-4 w-4" aria-hidden="true" />
              {t('ai.stop')} · {mmss(elapsed)}
            </button>
          )}

          <span className="text-xs font-medium text-slate-400">{t('ai.or')}</span>

          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50">
            <Upload className="h-4 w-4" aria-hidden="true" />
            {t('ai.upload')}
            <input
              type="file"
              accept="audio/*,video/webm"
              hidden
              disabled={recording || upload.isPending}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) uploadBlob(f, f.name)
                e.target.value = ''
              }}
            />
          </label>
        </div>
      )}

      {/* ---- Processing state ---- */}
      {busy && (
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/70 p-4">
          <Spinner size={22} />
          <span className="text-sm font-medium text-slate-600">
            {upload.isPending
              ? t('ai.uploading')
              : status === 'TRANSCRIBING'
                ? t('ai.transcribing')
                : status === 'EXTRACTING'
                  ? t('ai.extracting')
                  : t('ai.queued')}
          </span>
        </div>
      )}

      {/* ---- Failure ---- */}
      {status === 'FAILED' && (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50/70 p-4">
          <p className="text-sm font-semibold text-rose-700">{t('ai.failed')}</p>
          {session?.error && (
            <pre className="mt-2 max-h-32 overflow-auto rounded-lg bg-white/70 p-2.5 text-xs whitespace-pre-wrap text-rose-600">{session.error}</pre>
          )}
          <div className="mt-3 flex flex-wrap gap-3">
            <button type="button" onClick={() => retry.mutate()} disabled={retry.isPending} className={BTN_PRIMARY}>
              {retry.isPending && <Spinner size={14} />}{t('ai.retry')}
            </button>
            <button type="button" onClick={reset} className={BTN_SECONDARY}>{t('ai.discard')}</button>
          </div>
        </div>
      )}

      {/* ---- Committed ---- */}
      {committed && (
        <div className="mt-4 flex flex-col items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-semibold text-emerald-700">✓ {t('ai.committedDetail')}</p>
          <button type="button" onClick={reset} className={BTN_PRIMARY}>{t('ai.newRecording')}</button>
        </div>
      )}

      {/* ---- Review + edit draft ---- */}
      {status === 'READY' && draft && (
        <div className="mt-4">
          <div className="rounded-xl border-s-4 border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {t('ai.reviewWarning')}
          </div>

          {session?.transcript && (
            <div className="mt-4">
              <button
                type="button"
                onClick={() => setShowTranscript((s) => !s)}
                className="text-sm font-semibold text-[#0D9488] hover:underline"
              >
                {showTranscript ? '▾' : '▸'} {t('ai.transcript')}
              </button>
              {showTranscript && (
                <p className="mt-2 max-h-56 overflow-auto rounded-xl bg-slate-50 p-4 text-sm whitespace-pre-wrap text-slate-700" dir="auto">
                  {session.transcript}
                </p>
              )}
            </div>
          )}

          <h3 className={SECTION_DIVIDER}>{t('ai.draftHeading')}</h3>

          <FormField label={t('medical.chiefComplaint')}>
            {(p) => <input {...p} className="patient-field" dir="auto" value={draft.chief_complaint} onChange={(e) => setField('chief_complaint', e.target.value)} />}
          </FormField>
          <FormField label={t('medical.diagnosis')}>
            {(p) => <textarea {...p} className="patient-field" dir="auto" rows={2} value={draft.diagnosis} onChange={(e) => setField('diagnosis', e.target.value)} />}
          </FormField>
          <FormField label={t('medical.treatmentPlan')}>
            {(p) => <textarea {...p} className="patient-field" dir="auto" rows={2} value={draft.treatment_plan} onChange={(e) => setField('treatment_plan', e.target.value)} />}
          </FormField>

          {/* Vitals */}
          <h3 className={SECTION_DIVIDER}>{t('medical.vitals')}</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
            <FormField label={t('ai.vitals.blood_pressure')}>
              {(p) => <input {...p} className="patient-field" value={draft.vitals.blood_pressure} onChange={(e) => setVital('blood_pressure', e.target.value)} />}
            </FormField>
            <FormField label={t('ai.vitals.heart_rate')}>
              {(p) => <input {...p} className="patient-field" value={draft.vitals.heart_rate} onChange={(e) => setVital('heart_rate', e.target.value)} />}
            </FormField>
            <FormField label={t('ai.vitals.temperature')}>
              {(p) => <input {...p} className="patient-field" value={draft.vitals.temperature} onChange={(e) => setVital('temperature', e.target.value)} />}
            </FormField>
            <FormField label={t('ai.vitals.respiratory_rate')}>
              {(p) => <input {...p} className="patient-field" value={draft.vitals.respiratory_rate} onChange={(e) => setVital('respiratory_rate', e.target.value)} />}
            </FormField>
            <FormField label={t('ai.vitals.oxygen_saturation')}>
              {(p) => <input {...p} className="patient-field" value={draft.vitals.oxygen_saturation} onChange={(e) => setVital('oxygen_saturation', e.target.value)} />}
            </FormField>
            <FormField label={t('ai.vitals.weight')}>
              {(p) => <input {...p} className="patient-field" value={draft.vitals.weight} onChange={(e) => setVital('weight', e.target.value)} />}
            </FormField>
          </div>

          {/* Prescriptions */}
          <h3 className={SECTION_DIVIDER}>{t('medical.prescriptions')}</h3>
          {draft.prescriptions.length === 0 && <p className="mb-3 text-sm text-slate-500">{t('ai.noMeds')}</p>}
          {draft.prescriptions.map((rx, idx) => (
            <div key={idx} className="mb-3 rounded-xl border border-slate-100 bg-slate-50/60 p-3.5">
              <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_auto]">
                <FormField label={t('medical.medication')}>
                  {(p) => <input {...p} className="patient-field" dir="auto" value={rx.drug_name} onChange={(e) => setRx(idx, 'drug_name', e.target.value)} />}
                </FormField>
                <FormField label={t('medical.dosage')}>
                  {(p) => <input {...p} className="patient-field" value={rx.dosage} onChange={(e) => setRx(idx, 'dosage', e.target.value)} />}
                </FormField>
                <FormField label={t('medical.frequency')}>
                  {(p) => <input {...p} className="patient-field" dir="auto" value={rx.frequency} onChange={(e) => setRx(idx, 'frequency', e.target.value)} />}
                </FormField>
                <FormField label={t('medical.duration')}>
                  {(p) => <input {...p} className="patient-field" dir="auto" value={rx.duration} onChange={(e) => setRx(idx, 'duration', e.target.value)} />}
                </FormField>
                <div className="flex flex-col">
                  <span className="mb-2 block text-sm font-semibold text-transparent select-none" aria-hidden="true">·</span>
                  <button
                    type="button"
                    onClick={() => removeRx(idx)}
                    className="inline-flex h-[42px] items-center justify-center rounded-xl border border-rose-200 bg-rose-50 px-3 text-xs font-semibold text-rose-600 transition-colors hover:bg-rose-100"
                  >
                    {t('medical.removeItem')}
                  </button>
                </div>
              </div>
            </div>
          ))}
          <button type="button" onClick={addRx} className={BTN_SECONDARY}>{t('medical.addItem')}</button>

          {(draft.follow_up || draft.clinical_summary) && (
            <FormField label={t('ai.followUp')}>
              {(p) => <textarea {...p} className="patient-field" dir="auto" rows={2} value={draft.follow_up} onChange={(e) => setField('follow_up', e.target.value)} />}
            </FormField>
          )}

          <div className="mt-6 flex flex-wrap gap-3">
            <button type="button" onClick={() => commit.mutate()} disabled={commit.isPending} className={BTN_PRIMARY}>
              {commit.isPending && <Spinner size={14} />}{t('ai.commit')}
            </button>
            <button type="button" onClick={reset} disabled={commit.isPending} className={BTN_SECONDARY}>{t('ai.discard')}</button>
          </div>
        </div>
      )}
    </div>
  )
}
