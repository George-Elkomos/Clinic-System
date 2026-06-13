import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { Button } from '../../components/primitives/Button'
import { FormField } from '../../components/primitives/FormField'
import { Select } from '../../components/primitives/Select'
import { useToast } from '../../components/primitives/Toast'
import { errorMessage } from '../../services/apiClient'
import { doctorsApi } from '../../services/doctors.api'
import { staffApi } from '../../services/staff.api'
import type { CreateDoctorResponse } from '../../services/types'

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
      <div>
        <Breadcrumbs trail={[
          { label: t('staff.users'), to: '/manager/users' },
          { label: t('staff.createDoctor') },
        ]} />
        <h1>{t('staff.createDoctor')}</h1>
        <section className="card">
          <h2>{created.user.full_name}</h2>
          <p>{t('staff.doctorCreated')}</p>
          {created.temp_password && (
            <div className="temp-password-box">
              <p>{t('staff.tempPasswordNote')}</p>
              <div className="temp-password-box__code">{created.temp_password}</div>
              <Button
                variant="secondary"
                onClick={() => navigator.clipboard?.writeText(created.temp_password ?? '')}
                style={{ marginTop: 'var(--space-3)' }}
              >
                {t('staff.copyPassword')}
              </Button>
            </div>
          )}
          <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-5)', flexWrap: 'wrap' }}>
            <Button onClick={() => navigate('/manager/users')}>{t('staff.backToUsers')}</Button>
            <Button variant="secondary" onClick={() => setCreated(null)}>{t('staff.createAnotherDoctor')}</Button>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div>
      <Breadcrumbs trail={[
        { label: t('staff.users'), to: '/manager/users' },
        { label: t('staff.createDoctor') },
      ]} />
      <h1>{t('staff.createDoctor')}</h1>

      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault()
          createDoctor.mutate()
        }}
      >
        <div className="form-grid">
          <FormField label={t('auth.firstName')}>
            {(p) => <input {...p} value={form.first_name} onChange={(e) => update('first_name', e.target.value)} required />}
          </FormField>
          <FormField label={t('auth.lastName')}>
            {(p) => <input {...p} value={form.last_name} onChange={(e) => update('last_name', e.target.value)} required />}
          </FormField>
          <FormField label={t('auth.email')}>
            {(p) => (
              <input {...p} type="email" value={form.email} onChange={(e) => update('email', e.target.value)} required />
            )}
          </FormField>
          <FormField label={t('auth.phone')}>
            {(p) => <input {...p} value={form.phone} onChange={(e) => update('phone', e.target.value)} />}
          </FormField>
          <FormField label={t('staff.licenseNumber')}>
            {(p) => (
              <input
                {...p}
                value={form.license_number}
                onChange={(e) => update('license_number', e.target.value)}
                required
              />
            )}
          </FormField>
          <FormField label={t('doctors.room')}>
            {(p) => <input {...p} value={form.room_number} onChange={(e) => update('room_number', e.target.value)} />}
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
          {(p) => <textarea {...p} rows={4} value={form.bio} onChange={(e) => update('bio', e.target.value)} />}
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
              type="password"
              value={form.password}
              onChange={(e) => update('password', e.target.value)}
            />
          )}
        </FormField>

        <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <Button type="submit" loading={createDoctor.isPending}>{t('staff.createDoctor')}</Button>
          <Button variant="secondary" onClick={() => navigate('/manager/users')}>{t('common.cancel')}</Button>
        </div>
      </form>
    </div>
  )
}
