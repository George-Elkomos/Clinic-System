import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { FormField } from '../../components/primitives/FormField'
import { Select } from '../../components/primitives/Select'
import { Spinner } from '../../components/primitives/Spinner'
import { useToast } from '../../components/primitives/Toast'
import { errorMessage } from '../../services/apiClient'
import { doctorsApi } from '../../services/doctors.api'
import { staffApi } from '../../services/staff.api'
import type { CreateDoctorResponse } from '../../services/types'

const CARD = 'rounded-2xl border border-[#F3F4F6] bg-white p-5 shadow-sm sm:p-6'
const BTN_PRIMARY = 'inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#1AB5B3] to-[#38E4DD] px-5 py-2.5 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-95 disabled:opacity-60 sm:text-sm'
const BTN_SECONDARY = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-xs font-medium text-slate-700 transition-all hover:border-[#0D9488] hover:text-[#0D9488] disabled:opacity-60 sm:text-sm'
const BTN_SECONDARY_SM = 'inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-all hover:border-[#0D9488] hover:text-[#0D9488]'

export function CreateDoctorPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { showToast } = useToast()
  const [created, setCreated] = useState<CreateDoctorResponse | null>(null)
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    password: '',
    license_number: '',
    specialties: [] as number[],
    room_number: '',
    bio: '',
    photo: null as File | null,
  })

  const { data: specialties = [] } = useQuery({
    queryKey: ['specialties'],
    queryFn: doctorsApi.specialties,
  })

  const update = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const createDoctor = useMutation({
    mutationFn: () => staffApi.createDoctor(form),
    onSuccess: (data) => {
      setCreated(data)
      showToast(t('staff.doctorCreated'), 'success')
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  if (created) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <Breadcrumbs trail={[
            { label: t('staff.users'), to: '/manager/users' },
            { label: t('staff.createDoctor') },
          ]} />
          <h1 className="patient-text-page-title" style={{ color: 'var(--text-primary)' }}>{t('staff.createDoctor')}</h1>
        </div>
        <div className={CARD}>
          <h2 className="patient-text-card-title" style={{ color: 'var(--text-primary)' }}>{created.user.full_name}</h2>
          <p className="patient-text-body mt-1" style={{ color: 'var(--text-secondary)' }}>{t('staff.doctorCreated')}</p>
          {created.temp_password && (
            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="patient-text-body" style={{ color: 'var(--text-primary)' }}>{t('staff.tempPasswordNote')}</p>
              <div className="mt-2 rounded-lg bg-white px-3 py-2 text-center font-mono text-lg font-bold" style={{ color: 'var(--brand-teal-start)' }}>
                {created.temp_password}
              </div>
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(created.temp_password ?? '')}
                className={`${BTN_SECONDARY_SM} mt-3`}
              >
                {t('staff.copyPassword')}
              </button>
            </div>
          )}
          <div className="mt-5 flex flex-wrap gap-3">
            <button type="button" onClick={() => navigate('/manager/users')} className={BTN_PRIMARY}>{t('staff.backToUsers')}</button>
            <button type="button" onClick={() => setCreated(null)} className={BTN_SECONDARY}>{t('staff.createAnotherDoctor')}</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Breadcrumbs trail={[
          { label: t('staff.users'), to: '/manager/users' },
          { label: t('staff.createDoctor') },
        ]} />
        <h1 className="patient-text-page-title" style={{ color: 'var(--text-primary)' }}>{t('staff.createDoctor')}</h1>
      </div>

      <form
        className={CARD}
        onSubmit={(e) => {
          e.preventDefault()
          createDoctor.mutate()
        }}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label={t('auth.firstName')}>
            {(p) => <input {...p} className="patient-field" value={form.first_name} onChange={(e) => update('first_name', e.target.value)} required />}
          </FormField>
          <FormField label={t('auth.lastName')}>
            {(p) => <input {...p} className="patient-field" value={form.last_name} onChange={(e) => update('last_name', e.target.value)} required />}
          </FormField>
          <FormField label={t('auth.email')}>
            {(p) => (
              <input {...p} className="patient-field" type="email" value={form.email} onChange={(e) => update('email', e.target.value)} required />
            )}
          </FormField>
          <FormField label={t('auth.phone')}>
            {(p) => <input {...p} className="patient-field" value={form.phone} onChange={(e) => update('phone', e.target.value)} />}
          </FormField>
          <FormField label={t('staff.licenseNumber')}>
            {(p) => (
              <input
                {...p}
                className="patient-field"
                value={form.license_number}
                onChange={(e) => update('license_number', e.target.value)}
                required
              />
            )}
          </FormField>
          <FormField label={t('doctors.room')}>
            {(p) => <input {...p} className="patient-field" value={form.room_number} onChange={(e) => update('room_number', e.target.value)} />}
          </FormField>
        </div>

        <FormField label={t('staff.specialties')}>
          {(p) => (
            <Select
              id={p.id}
              options={specialties.map((specialty) => ({ value: specialty.id, label: specialty.name }))}
              value={form.specialties}
              onChange={(value) => update('specialties', (Array.isArray(value) ? value.map(Number) : []) as number[])}
              searchable
              multi
            />
          )}
        </FormField>

        <FormField label={t('doctors.bio')}>
          {(p) => <textarea {...p} className="patient-field" rows={4} value={form.bio} onChange={(e) => update('bio', e.target.value)} />}
        </FormField>

        <FormField label={t('staff.photo')}>
          {(p) => (
            <input
              {...p}
              type="file"
              accept="image/*"
              onChange={(e) => update('photo', e.target.files?.[0] ?? null)}
            />
          )}
        </FormField>

        <FormField label={t('auth.password')} hint={t('staff.passwordOptional')}>
          {(p) => (
            <input
              {...p}
              className="patient-field"
              type="password"
              value={form.password}
              onChange={(e) => update('password', e.target.value)}
            />
          )}
        </FormField>

        <div className="mt-2 flex flex-wrap gap-3">
          <button type="submit" disabled={createDoctor.isPending} className={BTN_PRIMARY}>
            {createDoctor.isPending && <Spinner size={14} />}{t('staff.createDoctor')}
          </button>
          <button type="button" onClick={() => navigate('/manager/users')} className={BTN_SECONDARY}>{t('common.cancel')}</button>
        </div>
      </form>
    </div>
  )
}
