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
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <header className="min-w-0">
          <h1 className="public-title-page font-bold text-slate-900">{t('doctors.publicTitle')}</h1>
          <p className="text-slate-500 text-sm mt-1">{t('doctors.publicSub')}</p>
        </header>

        <div className="flex flex-col sm:flex-row items-center gap-3 w-full max-w-xl">
          <div className="w-full sm:flex-1 min-w-0">
            <SearchInput onSearch={onSearch} placeholder={t('doctors.searchPlaceholder')} />
          </div>
          <div className="w-full sm:w-56 min-w-0">
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
          </div>
        </div>

        {isLoading ? (
          <CenteredSpinner />
        ) : (data ?? []).length === 0 ? (
          <p className="text-slate-500 text-sm">{t('doctors.noMatches')}</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {(data ?? []).map((doctor) => (
              <DoctorCard key={doctor.id} doctor={doctor} />
            ))}
          </div>
        )}
      </div>
    </PublicLayout>
  )
}
