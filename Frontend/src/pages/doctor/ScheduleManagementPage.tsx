import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { useConfirm } from '../../components/primitives/ConfirmDialog'
import { FormField } from '../../components/primitives/FormField'
import { Select } from '../../components/primitives/Select'
import { CenteredSpinner, Spinner } from '../../components/primitives/Spinner'
import { useToast } from '../../components/primitives/Toast'
import { useLanguage } from '../../hooks/useLanguage'
import { formatTimeOfDay } from '../../lib/format'
import { errorMessage } from '../../services/apiClient'
import { doctorsApi } from '../../services/doctors.api'

const CARD = 'rounded-2xl border border-[#F3F4F6] bg-white p-5 shadow-sm sm:p-6'
const BTN_PRIMARY = 'inline-flex items-center justify-center gap-2 rounded-xl bg-[#0D9488] border border-[#0B7A70] px-5 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-[#0B7A70] transition-all disabled:opacity-60 sm:text-sm'
const BTN_DANGER = 'inline-flex items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-medium text-rose-600 transition-all hover:bg-rose-100 disabled:opacity-60'

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

const HOURS_12 = Array.from({ length: 12 }, (_, i) => i + 1) // 1..12
const MINUTE_STEPS = Array.from({ length: 12 }, (_, i) => i * 5) // 00, 05, …, 55

function to12h(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number)
  const period: 'AM' | 'PM' = h >= 12 ? 'PM' : 'AM'
  const hour12 = h % 12 === 0 ? 12 : h % 12
  // Snap to the nearest 5-minute step the picker offers.
  const minute = MINUTE_STEPS.reduce((closest, step) => (
    Math.abs(step - m) < Math.abs(closest - m) ? step : closest
  ), 0)
  return { hour12, minute, period }
}

function to24h(hour12: number, minute: number, period: 'AM' | 'PM') {
  const h = period === 'PM' ? (hour12 % 12) + 12 : hour12 % 12
  return `${String(h).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

// Native <input type="time"> renders in whatever 12h/24h format the
// browser/OS locale dictates, ignoring the app's own language setting --
// this always shows a 12-hour clock with localized AM/PM (ص/م), matching
// how formatTimeOfDay already displays saved schedules everywhere else.
function TimeOfDayPicker({ id, value, onChange }: { id?: string; value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation()
  const { hour12, minute, period } = to12h(value)

  const asValue = (v: string | number | Array<string | number>) => (Array.isArray(v) ? v[0] : v)

  return (
    <div className="grid grid-cols-3 gap-2">
      <Select
        id={id}
        options={HOURS_12.map((h) => ({ value: h, label: String(h) }))}
        value={hour12}
        onChange={(v) => onChange(to24h(Number(asValue(v)), minute, period))}
      />
      <Select
        options={MINUTE_STEPS.map((m) => ({ value: m, label: String(m).padStart(2, '0') }))}
        value={minute}
        onChange={(v) => onChange(to24h(hour12, Number(asValue(v)), period))}
      />
      <Select
        options={[
          { value: 'AM', label: t('schedule.am') },
          { value: 'PM', label: t('schedule.pm') },
        ]}
        value={period}
        onChange={(v) => onChange(to24h(hour12, minute, asValue(v) as 'AM' | 'PM'))}
      />
    </div>
  )
}

export function ScheduleManagementPage() {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const qc = useQueryClient()

  const [weekday, setWeekday] = useState(0)
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('13:00')

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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label={t('schedule.startTime')}>
            {(p) => <TimeOfDayPicker id={p.id} value={startTime} onChange={setStartTime} />}
          </FormField>
          <FormField label={t('schedule.endTime')}>
            {(p) => <TimeOfDayPicker id={p.id} value={endTime} onChange={setEndTime} />}
          </FormField>
        </div>
        <p className="patient-text-body-secondary mt-3" style={{ color: 'var(--text-secondary)' }}>
          {t('schedule.durationFollowsProfile')}
        </p>
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
                  <strong>{t(`schedule.days.${s.weekday}`)}</strong> · {formatTimeOfDay(s.start_time, language)}–{formatTimeOfDay(s.end_time, language)}
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
