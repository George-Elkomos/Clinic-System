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
import { useToast } from '../../components/primitives/Toast'
import { errorMessage } from '../../services/apiClient'
import { doctorsApi } from '../../services/doctors.api'

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

export function ScheduleManagementPage() {
  const { t } = useTranslation()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const qc = useQueryClient()

  const [weekday, setWeekday] = useState(0)
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('13:00')
  const [slotDuration, setSlotDuration] = useState(15)

  const { data: schedules, isLoading } = useQuery({
    queryKey: ['my-schedules'],
    queryFn: () => doctorsApi.schedules(),
  })

  const create = useMutation({
    mutationFn: () =>
      doctorsApi.createSchedule({
        weekday,
        start_time: startTime,
        end_time: endTime,
        slot_duration: slotDuration,
        valid_from: todayISO(),
      }),
    onSuccess: () => {
      showToast(t('schedule.added'), 'success')
      qc.invalidateQueries({ queryKey: ['my-schedules'] })
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const remove = useMutation({
    mutationFn: (id: number) => doctorsApi.deleteSchedule(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-schedules'] }),
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const onRemove = async (id: number) => {
    if (await confirm({ title: t('schedule.remove'), message: t('schedule.removeConfirm'), danger: true })) {
      remove.mutate(id)
    }
  }

  return (
    <div>
      <Breadcrumbs trail={[{ label: t('schedule.title') }]} />
      <h1>{t('schedule.title')}</h1>
      <p>{t('schedule.intro')}</p>

      <Card title={t('schedule.add')}>
        <FormField label={t('schedule.weekday')}>
          {(p) => (
            <Select
              id={p.id}
              options={[0, 1, 2, 3, 4, 5, 6].map((d) => ({ value: d, label: t(`schedule.days.${d}`) }))}
              value={weekday}
              onChange={(v) => setWeekday(Array.isArray(v) ? 0 : Number(v))}
            />
          )}
        </FormField>
        <div className="schedule-time-row">
          <div className="schedule-time-field">
            <FormField label={t('schedule.startTime')}>
              {(p) => <input {...p} type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />}
            </FormField>
          </div>
          <div className="schedule-time-field">
            <FormField label={t('schedule.endTime')}>
              {(p) => <input {...p} type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />}
            </FormField>
          </div>
          <div className="schedule-time-field">
            <FormField label={t('schedule.slotDuration')}>
              {(p) => <input {...p} type="number" min={5} step={5} value={slotDuration} onChange={(e) => setSlotDuration(Number(e.target.value))} />}
            </FormField>
          </div>
        </div>
        <Button loading={create.isPending} onClick={() => create.mutate()} className="schedule-submit-btn">
          {create.isPending ? t('schedule.adding') : t('schedule.add')}
        </Button>
      </Card>

      <Card title={t('schedule.title')}>
        {isLoading ? (
          <CenteredSpinner />
        ) : (schedules ?? []).length === 0 ? (
          <p>{t('schedule.none')}</p>
        ) : (
          (schedules ?? []).map((s) => (
            <div key={s.id} className="schedule-row">
              <span>
                <strong>{t(`schedule.days.${s.weekday}`)}</strong> · {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}
              </span>
              <Button variant="danger" onClick={() => onRemove(s.id)}>{t('schedule.remove')}</Button>
            </div>
          ))
        )}
      </Card>
    </div>
  )
}
