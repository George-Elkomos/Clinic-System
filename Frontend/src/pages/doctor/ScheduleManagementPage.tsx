import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { useConfirm } from '../../components/primitives/ConfirmDialog'
import { FormField } from '../../components/primitives/FormField'
import { Select } from '../../components/primitives/Select'
import { CenteredSpinner, Spinner } from '../../components/primitives/Spinner'
import { useToast } from '../../components/primitives/Toast'
import { errorMessage } from '../../services/apiClient'
import { doctorsApi } from '../../services/doctors.api'

const CARD = 'rounded-2xl border border-[#F3F4F6] bg-white p-5 shadow-sm sm:p-6'
const BTN_PRIMARY = 'inline-flex items-center justify-center gap-2 rounded-xl bg-[#0D9488] border border-[#0B7A70] px-5 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-[#0B7A70] transition-all disabled:opacity-60 sm:text-sm'
const BTN_DANGER = 'inline-flex items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-medium text-rose-600 transition-all hover:bg-rose-100 disabled:opacity-60'

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
    <div className="flex flex-col gap-6">
      <div>
        <Breadcrumbs trail={[{ label: t('schedule.title') }]} />
        <h1 className="patient-text-page-title lg:hidden" style={{ color: 'var(--text-primary)' }}>{t('schedule.title')}</h1>
        <p className="patient-text-body-secondary mt-1" style={{ color: 'var(--text-secondary)' }}>{t('schedule.intro')}</p>
      </div>

      <div className={CARD}>
        <h2 className="patient-text-card-title mb-4" style={{ color: 'var(--text-primary)' }}>{t('schedule.add')}</h2>
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <FormField label={t('schedule.startTime')}>
            {(p) => <input {...p} className="patient-field" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />}
          </FormField>
          <FormField label={t('schedule.endTime')}>
            {(p) => <input {...p} className="patient-field" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />}
          </FormField>
          <FormField label={t('schedule.slotDuration')}>
            {(p) => <input {...p} className="patient-field" type="number" min={5} step={5} value={slotDuration} onChange={(e) => setSlotDuration(Number(e.target.value))} />}
          </FormField>
        </div>
        <button type="button" disabled={create.isPending} onClick={() => create.mutate()} className={`${BTN_PRIMARY} mt-4`}>
          {create.isPending && <Spinner size={14} />}
          {create.isPending ? t('schedule.adding') : t('schedule.add')}
        </button>
      </div>

      <div className={CARD}>
        <h2 className="patient-text-card-title mb-4" style={{ color: 'var(--text-primary)' }}>{t('schedule.title')}</h2>
        {isLoading ? (
          <CenteredSpinner />
        ) : (schedules ?? []).length === 0 ? (
          <p className="patient-text-body-secondary" style={{ color: 'var(--text-secondary)' }}>{t('schedule.none')}</p>
        ) : (
          <div className="flex flex-col divide-y divide-slate-100">
            {(schedules ?? []).map((s) => (
              <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span className="patient-text-body" style={{ color: 'var(--text-primary)' }}>
                  <strong>{t(`schedule.days.${s.weekday}`)}</strong> · {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}
                </span>
                <button type="button" onClick={() => onRemove(s.id)} className={BTN_DANGER}>{t('schedule.remove')}</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
