import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { FormField } from '../../components/primitives/FormField'
import { CenteredSpinner, Spinner } from '../../components/primitives/Spinner'
import { useToast } from '../../components/primitives/Toast'
import { errorMessage } from '../../services/apiClient'
import { doctorsApi } from '../../services/doctors.api'
import type { Doctor } from '../../services/types'

const CARD = 'rounded-2xl border border-[#F3F4F6] bg-white p-5 shadow-sm sm:p-6'
const BTN_PRIMARY = 'inline-flex items-center justify-center gap-2 rounded-xl bg-[#0D9488] border border-[#0B7A70] px-5 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-[#0B7A70] transition-all disabled:opacity-60 sm:text-sm'
const BTN_SECONDARY = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-all disabled:opacity-60 sm:text-sm'

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
    <div className={CARD}>
      <h2 className="patient-text-card-title mb-4" style={{ color: 'var(--text-primary)' }}>
        {doctor.full_name} · {doctor.specialties_detail.map((s) => s.name).join(', ')}
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <FormField label={t('doctors.room')}>
          {(p) => <input {...p} className="patient-field" value={room} onChange={(e) => setRoom(e.target.value)} />}
        </FormField>
        <div className="sm:col-span-2">
          <FormField label={t('doctors.bio')}>
            {(p) => <input {...p} className="patient-field" value={bio} onChange={(e) => setBio(e.target.value)} />}
          </FormField>
        </div>
      </div>
      <label className="patient-text-body mb-3 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
        <input type="checkbox" checked={accepting} onChange={(e) => setAccepting(e.target.checked)} />
        {t('doctors.acceptingPatients')}
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={save.isPending} onClick={() => save.mutate()} className={BTN_PRIMARY}>
          {save.isPending && <Spinner size={14} />}{t('common.save')}
        </button>
        <Link to={`/kiosk/${doctor.id}`} target="_blank" rel="noopener noreferrer">
          <button type="button" className={BTN_SECONDARY}>📺 {t('doctors.openKiosk')}</button>
        </Link>
      </div>
    </div>
  )
}

export function DoctorsPage() {
  const { t } = useTranslation()
  const { data, isLoading } = useQuery({
    queryKey: ['secretary-doctors'],
    queryFn: () => doctorsApi.list(),
  })

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Breadcrumbs trail={[{ label: t('nav.doctors') }]} />
        <h1 className="patient-text-page-title lg:hidden" style={{ color: 'var(--text-primary)' }}>{t('nav.doctors')}</h1>
      </div>
      {isLoading ? (
        <CenteredSpinner />
      ) : (
        <div className="flex flex-col gap-4">
          {(data?.results ?? []).map((d) => <DoctorEditor key={d.id} doctor={d} />)}
        </div>
      )}
    </div>
  )
}
