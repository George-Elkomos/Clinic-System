import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { Button } from '../../components/primitives/Button'
import { Card } from '../../components/primitives/Card'
import { useConfirm } from '../../components/primitives/ConfirmDialog'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { useToast } from '../../components/primitives/Toast'
import { useLanguage } from '../../hooks/useLanguage'
import { formatTime } from '../../lib/format'
import { errorMessage } from '../../services/apiClient'
import { appointmentsApi } from '../../services/appointments.api'
import type { QueueAppointment } from '../../services/types'

function ageFromDob(dob: string | null): string {
  if (!dob) return ''
  const years = Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 3600 * 1000))
  return `${years}y`
}

function InfoRow({ label, value }: { label: string; value: string }) {
  if (!value) return null
  return (
    <div style={{ marginBottom: 'var(--space-2)' }}>
      <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
      <div style={{ fontSize: '0.95rem' }}>{value}</div>
    </div>
  )
}

function AllergyBanner({ allergies }: { allergies: string }) {
  if (!allergies) return null
  return (
    <div style={{
      background: 'var(--color-error-bg, #fff0f0)',
      border: '1px solid var(--color-error, #e53e3e)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-2) var(--space-3)',
      marginBottom: 'var(--space-3)',
      fontSize: '0.9rem',
    }}>
      <strong>⚠ Allergies:</strong> {allergies}
    </div>
  )
}

function CurrentPanel({
  appt,
  onComplete,
  onNoShow,
  isPending,
}: {
  appt: QueueAppointment | null
  onComplete: (id: number) => void
  onNoShow: (id: number) => void
  isPending: boolean
}) {
  const { t } = useTranslation()
  const { language } = useLanguage()

  if (!appt) {
    return (
      <Card title={t('queue.current')}>
        <div style={{ textAlign: 'center', padding: 'var(--space-6) 0', color: 'var(--text-muted)' }}>
          {t('queue.noCurrent')}
        </div>
      </Card>
    )
  }

  const chips: string[] = [
    appt.patient_gender && appt.patient_gender !== '' ? appt.patient_gender : '',
    ageFromDob(appt.patient_dob),
    appt.patient_blood_type || '',
  ].filter(Boolean)

  return (
    <div className="queue-card--current">
      <Card title={t('queue.current')}>
        <div className="queue-patient-header">
          <h2 className="queue-patient-name">{appt.patient_name}</h2>
          {chips.map((c) => (
            <span key={c} className="queue-chip">{c}</span>
          ))}
          <span className={`badge badge--${appt.appointment_type}`}>{appt.type_display}</span>
        </div>

        {appt.patient_phone && (
          <div className="queue-panel-meta">{appt.patient_phone}</div>
        )}

        {appt.started_at && (
          <div className="queue-panel-meta">
            {t('queue.startedAt', { time: formatTime(appt.started_at, language) })}
          </div>
        )}

        {appt.reason && <InfoRow label={t('appointments.reason')} value={appt.reason} />}

        <AllergyBanner allergies={appt.patient_allergies} />

        {appt.patient_chronic_conditions && (
          <InfoRow label={t('queue.chronicConditions')} value={appt.patient_chronic_conditions} />
        )}
        {appt.patient_current_medications && (
          <InfoRow label={t('queue.currentMedications')} value={appt.patient_current_medications} />
        )}

        <div className="queue-actions">
          <Button loading={isPending} onClick={() => onComplete(appt.id)}>
            {t('queue.complete')}
          </Button>
          <Link to={`/doctor/patients?patient=${appt.patient_profile_id}`}>
            <Button variant="secondary">{t('queue.openRecord')}</Button>
          </Link>
          <Button variant="danger" loading={isPending} onClick={() => onNoShow(appt.id)}>
            {t('queue.noShow')}
          </Button>
        </div>
      </Card>
    </div>
  )
}

function NextPanel({
  appt,
  onCallNext,
  isPending,
}: {
  appt: QueueAppointment | null
  onCallNext: (id: number) => void
  isPending: boolean
}) {
  const { t } = useTranslation()
  const { language } = useLanguage()

  if (!appt) {
    return (
      <Card title={t('queue.next')}>
        <p style={{ color: 'var(--text-muted)' }}>{t('queue.noNext')}</p>
      </Card>
    )
  }

  return (
    <Card title={t('queue.next')}>
      <h3 className="queue-patient-name">{appt.patient_name}</h3>
      <div className="queue-panel-meta">{formatTime(appt.scheduled_start, language)}</div>
      {appt.reason && (
        <div className="queue-panel-reason">{appt.reason}</div>
      )}
      <span className={`badge badge--${appt.appointment_type}`}>{appt.type_display}</span>
      <div className="queue-next-action">
        <Button loading={isPending} onClick={() => onCallNext(appt.id)}>
          {t('queue.callNext')}
        </Button>
      </div>
    </Card>
  )
}

function PreviousPanel({ appt }: { appt: QueueAppointment | null }) {
  const { t } = useTranslation()
  const { language } = useLanguage()

  if (!appt) {
    return (
      <Card title={t('queue.previous')}>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>—</p>
      </Card>
    )
  }

  return (
    <Card title={t('queue.previous')}>
      <h3 className="queue-patient-name queue-patient-name--muted">{appt.patient_name}</h3>
      {appt.completed_at && (
        <div className="queue-panel-meta">
          {t('queue.completedAt', { time: formatTime(appt.completed_at, language) })}
        </div>
      )}
      {appt.reason && (
        <div className="queue-panel-meta">{appt.reason}</div>
      )}
    </Card>
  )
}

export function DoctorQueuePage() {
  const { t } = useTranslation()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['doctor-queue'],
    queryFn: () => appointmentsApi.myQueue(),
    refetchInterval: 15_000,
  })

  const complete = useMutation({
    mutationFn: (id: number) => appointmentsApi.complete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor-queue'] })
      qc.invalidateQueries({ queryKey: ['appointments'] })
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const noShow = useMutation({
    mutationFn: (id: number) => appointmentsApi.noShow(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor-queue'] })
      qc.invalidateQueries({ queryKey: ['appointments'] })
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const callNext = useMutation({
    mutationFn: (id: number) => appointmentsApi.start(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor-queue'] })
      qc.invalidateQueries({ queryKey: ['appointments'] })
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const handleNoShow = async (id: number) => {
    const ok = await confirm({
      title: t('queue.noShow'),
      message: t('queue.noShowConfirm'),
      confirmLabel: t('queue.noShow'),
      danger: true,
    })
    if (ok) noShow.mutate(id)
  }

  if (isLoading) return <CenteredSpinner />

  const { previous = null, current = null, next = null, waiting_count = 0 } = data ?? {}

  return (
    <div>
      <div className="page-heading-row">
        <h1>{t('queue.liveTitle')}</h1>
        <span className={`queue-waiting-badge${waiting_count > 0 ? ' queue-waiting-badge--active' : ''}`}>
          {t('queue.waiting', { count: waiting_count })}
        </span>
      </div>

      <div className="queue-grid">
        <PreviousPanel appt={previous ?? null} />
        <CurrentPanel
          appt={current ?? null}
          onComplete={(id) => complete.mutate(id)}
          onNoShow={handleNoShow}
          isPending={complete.isPending || noShow.isPending}
        />
        <NextPanel
          appt={next ?? null}
          onCallNext={(id) => callNext.mutate(id)}
          isPending={callNext.isPending}
        />
      </div>

      <p className="queue-footer">
        {t('queue.autoRefresh')}
      </p>
    </div>
  )
}
