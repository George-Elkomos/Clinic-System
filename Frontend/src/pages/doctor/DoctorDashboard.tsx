import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { Card } from '../../components/primitives/Card'
import { Button } from '../../components/primitives/Button'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { StatusBadge } from '../../components/primitives/StatusBadge'
import { useToast } from '../../components/primitives/Toast'
import { PendingOrdersWidget } from '../../components/lab/PendingOrdersWidget'
import { CriticalResultsWidget } from '../../components/lab/CriticalResultsWidget'
import { RecentLabsWidget } from '../../components/lab/RecentLabsWidget'
import { useAuth } from '../../hooks/useAuth'
import { useLanguage } from '../../hooks/useLanguage'
import { formatTime } from '../../lib/format'
import { errorMessage } from '../../services/apiClient'
import { appointmentsApi } from '../../services/appointments.api'
import type { Appointment } from '../../services/types'

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

export function DoctorDashboard() {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { user } = useAuth()
  const { showToast } = useToast()
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['appointments', 'today'],
    queryFn: () => appointmentsApi.list({ date: todayISO() }),
  })

  const transition = useMutation({
    mutationFn: ({ id, action }: { id: number; action: 'checkIn' | 'start' | 'complete' }) =>
      appointmentsApi[action](id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['appointments'] }),
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const rows = (data?.results ?? []).filter((a) => a.status !== 'CANCELLED')

  const nextAction = (a: Appointment) => {
    if (a.status === 'CONFIRMED') return { action: 'checkIn' as const, label: t('appointments.checkIn') }
    if (a.status === 'CHECKED_IN') return { action: 'start' as const, label: t('appointments.start') }
    if (a.status === 'IN_PROGRESS') return { action: 'complete' as const, label: t('appointments.complete') }
    return null
  }

  return (
    <div>
      <h1>{t('dashboard.welcome', { name: user?.first_name || user?.email })}</h1>
      <p>{t('dashboard.doctorIntro')}</p>

      <div className="lab-kpi-row">
        <PendingOrdersWidget />
        <CriticalResultsWidget />
      </div>
      <RecentLabsWidget />

      <Card title={t('dashboard.todayQueue')}>
        {isLoading ? (
          <CenteredSpinner />
        ) : rows.length === 0 ? (
          <p>{t('appointments.none')}</p>
        ) : (
          rows.map((a) => {
            const action = nextAction(a)
            return (
              <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-3) 0', borderBottom: '1px solid var(--surface-2)', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                <div>
                  <strong>{a.patient_name}</strong>
                  <div style={{ color: 'var(--text-muted)' }}>{formatTime(a.scheduled_start, language)}</div>
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
                  <StatusBadge status={a.status} />
                  {action && (
                    <Button onClick={() => transition.mutate({ id: a.id, action: action.action })}>
                      {action.label}
                    </Button>
                  )}
                </div>
              </div>
            )
          })
        )}
      </Card>
    </div>
  )
}
