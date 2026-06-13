import { useQuery } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DoctorCard } from '../../components/DoctorCard'
import { PublicLayout } from '../../components/layout/PublicLayout'
import { SearchInput } from '../../components/primitives/SearchInput'
import { Select } from '../../components/primitives/Select'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { publicApi } from '../../services/apiClient'
import type { Paginated, PublicDoctor, Specialty } from '../../services/types'

export function PublicDoctorsPage() {
  const { t, i18n } = useTranslation()
  const isAr = i18n.language === 'ar'
  const [search, setSearch] = useState('')
  const [specialty, setSpecialty] = useState<string | number>('')
  const onSearch = useCallback((value: string) => setSearch(value), [])

  const { data: specialties = [] } = useQuery({
    queryKey: ['public-specialties'],
    queryFn: () => publicApi.get<Paginated<Specialty>>('/specialties/').then((r) => r.data.results),
  })

  const { data, isLoading } = useQuery({
    queryKey: ['public-doctors', search, specialty],
    queryFn: () =>
      publicApi
        .get<Paginated<PublicDoctor>>('/public/doctors/', {
          params: {
            search: search || undefined,
            specialties: specialty || undefined,
          },
        })
        .then((r) => r.data.results),
  })

  return (
    <PublicLayout>
      <main className="pub-main">
        <header style={{ marginBottom: 'var(--space-5)' }}>
          <h1>{t('doctors.publicTitle')}</h1>
          <p style={{ color: 'var(--text-muted)' }}>{t('doctors.publicSub')}</p>
        </header>

        <section className="filter-bar" aria-label={t('doctors.filters')}>
          <SearchInput onSearch={onSearch} placeholder={t('doctors.searchPlaceholder')} />
          <Select
            options={specialties.map((item) => ({
              value: item.id,
              label: isAr && item.name_ar ? item.name_ar : item.name,
            }))}
            value={specialty}
            onChange={(v) => setSpecialty(Array.isArray(v) ? '' : v)}
            placeholder={t('doctors.filterSpecialty')}
            searchable
          />
        </section>

        {isLoading ? (
          <CenteredSpinner />
        ) : (data ?? []).length === 0 ? (
          <p>{t('doctors.noMatches')}</p>
        ) : (
          <section className="doctor-grid">
            {(data ?? []).map((doctor) => (
              <DoctorCard key={doctor.id} doctor={doctor} />
            ))}
          </section>
        )}
      </main>
    </PublicLayout>
  )
}
