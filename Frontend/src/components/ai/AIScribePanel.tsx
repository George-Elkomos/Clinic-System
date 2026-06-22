import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { aiApi, type AIDraft, type AISession } from '../../services/ai.api'
import { errorMessage } from '../../services/apiClient'
import { Button } from '../primitives/Button'
import { Card } from '../primitives/Card'
import { FormField } from '../primitives/FormField'
import { Spinner } from '../primitives/Spinner'
import { useToast } from '../primitives/Toast'

const PROCESSING: AISession['status'][] = ['PENDING', 'TRANSCRIBING', 'EXTRACTING']

const EMPTY_RX = { drug_name: '', dosage: '', frequency: '', duration: '', instructions: '' }

function mmss(total: number) {
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
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
    <Card title={t('ai.title')}>
      <p className="ai-intro">{t('ai.intro')}</p>

      {/* ---- Capture controls (hidden once a session is in flight) ---- */}
      {!sessionId && (
        <div className="ai-capture">
          {!recording ? (
            <Button onClick={startRecording} disabled={upload.isPending}>
              ● {t('ai.record')}
            </Button>
          ) : (
            <Button variant="danger" onClick={stopRecording}>
              ■ {t('ai.stop')} · {mmss(elapsed)}
            </Button>
          )}

          <span className="ai-or">{t('ai.or')}</span>

          <label className="btn btn--secondary ai-file-btn">
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
        <div className="ai-processing">
          <Spinner size={22} />
          <span>
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
        <div className="ai-error">
          <p>{t('ai.failed')}</p>
          {session?.error && <pre className="ai-error-detail">{session.error}</pre>}
          <div className="ai-actions">
            <Button onClick={() => retry.mutate()} loading={retry.isPending}>{t('ai.retry')}</Button>
            <Button variant="secondary" onClick={reset}>{t('ai.discard')}</Button>
          </div>
        </div>
      )}

      {/* ---- Committed ---- */}
      {committed && (
        <div className="ai-committed">
          <p>✓ {t('ai.committedDetail')}</p>
          <Button onClick={reset}>{t('ai.newRecording')}</Button>
        </div>
      )}

      {/* ---- Review + edit draft ---- */}
      {status === 'READY' && draft && (
        <div className="ai-review">
          <div className="ai-disclaimer">{t('ai.reviewWarning')}</div>

          {session?.transcript && (
            <div className="ai-transcript">
              <button type="button" className="ai-transcript-toggle" onClick={() => setShowTranscript((s) => !s)}>
                {showTranscript ? '▾' : '▸'} {t('ai.transcript')}
              </button>
              {showTranscript && <p className="ai-transcript-body" dir="auto">{session.transcript}</p>}
            </div>
          )}

          <h3 className="medical-section-divider">{t('ai.draftHeading')}</h3>

          <FormField label={t('medical.chiefComplaint')}>
            {(p) => <input {...p} dir="auto" value={draft.chief_complaint} onChange={(e) => setField('chief_complaint', e.target.value)} />}
          </FormField>
          <FormField label={t('medical.diagnosis')}>
            {(p) => <textarea {...p} dir="auto" rows={2} value={draft.diagnosis} onChange={(e) => setField('diagnosis', e.target.value)} />}
          </FormField>
          <FormField label={t('medical.treatmentPlan')}>
            {(p) => <textarea {...p} dir="auto" rows={2} value={draft.treatment_plan} onChange={(e) => setField('treatment_plan', e.target.value)} />}
          </FormField>

          {/* Vitals */}
          <h3 className="medical-section-divider">{t('medical.vitals')}</h3>
          <div className="ai-vitals-grid">
            <FormField label={t('ai.vitals.blood_pressure')}>
              {(p) => <input {...p} value={draft.vitals.blood_pressure} onChange={(e) => setVital('blood_pressure', e.target.value)} />}
            </FormField>
            <FormField label={t('ai.vitals.heart_rate')}>
              {(p) => <input {...p} value={draft.vitals.heart_rate} onChange={(e) => setVital('heart_rate', e.target.value)} />}
            </FormField>
            <FormField label={t('ai.vitals.temperature')}>
              {(p) => <input {...p} value={draft.vitals.temperature} onChange={(e) => setVital('temperature', e.target.value)} />}
            </FormField>
            <FormField label={t('ai.vitals.respiratory_rate')}>
              {(p) => <input {...p} value={draft.vitals.respiratory_rate} onChange={(e) => setVital('respiratory_rate', e.target.value)} />}
            </FormField>
            <FormField label={t('ai.vitals.oxygen_saturation')}>
              {(p) => <input {...p} value={draft.vitals.oxygen_saturation} onChange={(e) => setVital('oxygen_saturation', e.target.value)} />}
            </FormField>
            <FormField label={t('ai.vitals.weight')}>
              {(p) => <input {...p} value={draft.vitals.weight} onChange={(e) => setVital('weight', e.target.value)} />}
            </FormField>
          </div>

          {/* Prescriptions */}
          <h3 className="medical-section-divider">{t('medical.prescriptions')}</h3>
          {draft.prescriptions.length === 0 && <p className="ai-muted">{t('ai.noMeds')}</p>}
          {draft.prescriptions.map((rx, idx) => (
            <div key={idx} className="medical-rx-item">
              <div className="medical-rx-field--wide">
                <FormField label={t('medical.medication')}>
                  {(p) => <input {...p} dir="auto" value={rx.drug_name} onChange={(e) => setRx(idx, 'drug_name', e.target.value)} />}
                </FormField>
              </div>
              <div className="medical-rx-field">
                <FormField label={t('medical.dosage')}>
                  {(p) => <input {...p} value={rx.dosage} onChange={(e) => setRx(idx, 'dosage', e.target.value)} />}
                </FormField>
              </div>
              <div className="medical-rx-field--mid">
                <FormField label={t('medical.frequency')}>
                  {(p) => <input {...p} dir="auto" value={rx.frequency} onChange={(e) => setRx(idx, 'frequency', e.target.value)} />}
                </FormField>
              </div>
              <div className="medical-rx-field">
                <FormField label={t('medical.duration')}>
                  {(p) => <input {...p} dir="auto" value={rx.duration} onChange={(e) => setRx(idx, 'duration', e.target.value)} />}
                </FormField>
              </div>
              <button type="button" className="ai-rx-remove" onClick={() => removeRx(idx)}>
                {t('medical.removeItem')}
              </button>
            </div>
          ))}
          <Button variant="secondary" onClick={addRx}>{t('medical.addItem')}</Button>

          {(draft.follow_up || draft.clinical_summary) && (
            <FormField label={t('ai.followUp')}>
              {(p) => <textarea {...p} dir="auto" rows={2} value={draft.follow_up} onChange={(e) => setField('follow_up', e.target.value)} />}
            </FormField>
          )}

          <div className="ai-actions ai-commit-row">
            <Button onClick={() => commit.mutate()} loading={commit.isPending}>{t('ai.commit')}</Button>
            <Button variant="secondary" onClick={reset} disabled={commit.isPending}>{t('ai.discard')}</Button>
          </div>
        </div>
      )}
    </Card>
  )
}
