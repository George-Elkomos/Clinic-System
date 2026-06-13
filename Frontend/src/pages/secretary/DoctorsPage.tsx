import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { Button } from '../../components/primitives/Button'
import { Card } from '../../components/primitives/Card'
import { FormField } from '../../components/primitives/FormField'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { useToast } from '../../components/primitives/Toast'
import { errorMessage } from '../../services/apiClient'
import { doctorsApi } from '../../services/doctors.api'
import type { Doctor } from '../../services/types'

function DoctorEditor({ doctor }: { doctor: Doctor }) {
  const { t } = useTranslation()
  const { showToast } = useToast()
  const qc = useQueryClient()
  const [room, setRoom] = useState(doctor.room_number)
  const [accepting, setAccepting] = useState(doctor.is_accepting_patients)
  const [bio, setBio] = useState(doctor.bio)

  const save = useMutation({
    mutationFn: () =>
      doctorsApi.update(doctor.id, { room_number: room, is_accepting_patients: accepting, bio }),
    onSuccess: () => {
      showToast(t('common.save'), 'success')
      qc.invalidateQueries({ queryKey: ['secretary-doctors'] })
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  return (
    <Card title={`${doctor.full_name} · ${doctor.specialties_detail.map((s) => s.name).join(', ')}`}>
      <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 160 }}>
          <FormField label={t('doctors.room')}>
            {(p) => <input {...p} value={room} onChange={(e) => setRoom(e.target.value)} />}
          </FormField>
        </div>
        <div style={{ flex: 2, minWidth: 220 }}>
          <FormField label={t('doctors.bio')}>
            {(p) => <input {...p} value={bio} onChange={(e) => setBio(e.target.value)} />}
          </FormField>
        </div>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
        <input type="checkbox" style={{ width: 'auto', minHeight: 'auto' }} checked={accepting} onChange={(e) => setAccepting(e.target.checked)} />
        {t('doctors.acceptingPatients')}
      </label>
      <Button loading={save.isPending} onClick={() => save.mutate()}>{t('common.save')}</Button>
    </Card>
  )
}

export function DoctorsPage() {
  const { t } = useTranslation()
  const { data, isLoading } = useQuery({
    queryKey: ['secretary-doctors'],
    queryFn: () => doctorsApi.list(),
  })

  return (
    <div>
      <Breadcrumbs trail={[{ label: t('nav.doctors') }]} />
      <h1>{t('nav.doctors')}</h1>
      {isLoading ? (
        <CenteredSpinner />
      ) : (
        (data?.results ?? []).map((d) => <DoctorEditor key={d.id} doctor={d} />)
      )}
    </div>
  )
}
