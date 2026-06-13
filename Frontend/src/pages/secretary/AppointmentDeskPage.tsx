import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { Button } from '../../components/primitives/Button'
import { Card } from '../../components/primitives/Card'
import { useConfirm } from '../../components/primitives/ConfirmDialog'
import { FormField } from '../../components/primitives/FormField'
import { Select } from '../../components/primitives/Select'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { StatusBadge } from '../../components/primitives/StatusBadge'
import { useToast } from '../../components/primitives/Toast'
import { useLanguage } from '../../hooks/useLanguage'
import { formatDateTime } from '../../lib/format'
import { errorMessage } from '../../services/apiClient'
import { appointmentsApi } from '../../services/appointments.api'
import type { Appointment, AppointmentStatus } from '../../services/types'

const STATUSES: AppointmentStatus[] = ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']

export function AppointmentDeskPage() {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const qc = useQueryClient()
  const [status, setStatus] = useState<string>('PENDING')

  const { data, isLoading } = useQuery({
    queryKey: ['appointments', 'desk', status],
    queryFn: () => appointmentsApi.list(status ? { status } : undefined),
  })

  const confirmAppt = useMutation({
    mutationFn: (id: number) => appointmentsApi.confirm(id),
    onSuccess: () => {
      showToast(t('appointments.confirmed'), 'success')
      qc.invalidateQueries({ queryKey: ['appointments'] })
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const cancelAppt = useMutation({
    mutationFn: (id: number) => appointmentsApi.cancel(id),
    onSuccess: () => {
      showToast(t('appointments.cancelled'), 'success')
      qc.invalidateQueries({ queryKey: ['appointments'] })
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const onCancel = async (a: Appointment) => {
    const ok = await confirm({
      title: t('appointments.cancel'),
      message: t('appointments.cancelConfirm', {
        name: a.patient_name,
        when: formatDateTime(a.scheduled_start, language),
      }),
      confirmLabel: t('appointments.cancel'),
      danger: true,
    })
    if (ok) cancelAppt.mutate(a.id)
  }

  const rows = data?.results ?? []

  return (
    <div>
      <Breadcrumbs trail={[{ label: t('nav.appointmentDesk') }]} />
      <h1>{t('nav.appointmentDesk')}</h1>

      <Card>
        <FormField label={t('appointments.status')}>
          {(p) => (
            <Select
              id={p.id}
              options={[
                { value: '', label: t('appointments.filterAll') },
                ...STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) })),
              ]}
              value={status}
              onChange={(v) => setStatus(Array.isArray(v) ? '' : String(v))}
            />
          )}
        </FormField>
      </Card>

      {isLoading ? (
        <CenteredSpinner />
      ) : rows.length === 0 ? (
        <Card><p>{t('appointments.noResults')}</p></Card>
      ) : (
        rows.map((a) => (
          <Card key={a.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              <div>
                <h3 style={{ margin: 0 }}>{a.patient_name}</h3>
                <div style={{ color: 'var(--text-muted)' }}>
                  {a.doctor_name} · {formatDateTime(a.scheduled_start, language)}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
                <StatusBadge status={a.status} />
                {a.status === 'PENDING' && (
                  <Button onClick={() => confirmAppt.mutate(a.id)} loading={confirmAppt.isPending && confirmAppt.variables === a.id}>
                    {t('appointments.confirm')}
                  </Button>
                )}
                {['PENDING', 'CONFIRMED'].includes(a.status) && (
                  <Button variant="danger" onClick={() => onCancel(a)}>{t('appointments.cancel')}</Button>
                )}
              </div>
            </div>
          </Card>
        ))
      )}
    </div>
  )
}
