import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Activity } from 'lucide-react'

import { CenteredSpinner } from '../primitives/Spinner'
import { useToast } from '../primitives/Toast'
import { useConfirm } from '../primitives/ConfirmDialog'
import { VitalSignsCard } from './VitalSignsCard'
import { VitalSignsForm } from './VitalSignsForm'
import { useAuth } from '../../hooks/useAuth'
import { vitalsApi } from '../../services/vitals.api'
import { errorMessage } from '../../services/apiClient'
import type { VitalSigns } from '../../services/types'

const BTN_SECONDARY_SM = 'inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-40'

interface VitalSignsHistoryProps {
  patientId: number
  readOnly?: boolean
}

const PAGE_SIZE = 5

export function VitalSignsHistory({ patientId, readOnly = false }: VitalSignsHistoryProps) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<VitalSigns | null>(null)

  const canDelete = user?.role === 'MANAGER'
  const isManager = user?.role === 'MANAGER'
  const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000

  const isExpired = (record: VitalSigns) =>
    !isManager && Date.now() - new Date(record.created_at).getTime() > EDIT_WINDOW_MS

  const { data, isLoading, isError } = useQuery({
    queryKey: ['vitals', patientId, page],
    queryFn: () => vitalsApi.list(patientId, page, PAGE_SIZE),
    staleTime: 30_000,
    retry: 1,
  })

  const del = useMutation({
    mutationFn: (id: number) => vitalsApi.delete(id),
    onSuccess: () => {
      showToast(t('vitals.deleted'), 'success')
      if (records.length === 1 && page > 1) setPage((p) => p - 1)
      qc.invalidateQueries({ queryKey: ['vitals', patientId] })
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const handleDelete = async (record: VitalSigns) => {
    const ok = await confirm({
      title: t('vitals.deleteConfirmTitle'),
      message: t('vitals.deleteConfirmMessage'),
      danger: true,
    })
    if (ok) del.mutate(record.id)
  }

  if (isLoading) return <CenteredSpinner />
  if (isError) return <p className="patient-text-body-secondary" style={{ color: 'var(--text-secondary)' }}>{t('vitals.loadError')}</p>

  const records = data?.results ?? []
  const totalPages = data ? Math.ceil(data.count / PAGE_SIZE) : 1

  if (records.length === 0 && page === 1) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-100 bg-slate-50/60 p-8 text-center">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0D9488]/10 text-[#0D9488]">
          <Activity className="h-6 w-6" aria-hidden="true" />
        </div>
        <span className="text-sm font-medium text-slate-500">{t('vitals.noHistory')}</span>
      </div>
    )
  }

  return (
    <div>
      {records.map((record) => (
        <div key={record.id}>
          {editing?.id === record.id ? (
            <div className="mb-4 rounded-2xl border border-slate-100 bg-slate-50/60 p-4 sm:p-5">
              <VitalSignsForm
                patientId={patientId}
                initial={record}
                onSuccess={() => setEditing(null)}
                onCancel={() => setEditing(null)}
              />
            </div>
          ) : (
            <VitalSignsCard
              record={record}
              onEdit={readOnly || isExpired(record) ? undefined : () => setEditing(record)}
              editLocked={!readOnly && isExpired(record)}
              onDelete={readOnly || !canDelete ? undefined : () => handleDelete(record)}
            />
          )}
        </div>
      ))}

      {totalPages > 1 && (
        <div className="mt-2 flex items-center justify-center gap-3">
          <button type="button" disabled={page === 1} onClick={() => setPage((p) => p - 1)} className={BTN_SECONDARY_SM}>
            {t('vitals.prevPage')}
          </button>
          <span className="text-xs font-medium text-slate-500">{t('vitals.page')} {page} {t('vitals.of')} {totalPages}</span>
          <button type="button" disabled={page === totalPages} onClick={() => setPage((p) => p + 1)} className={BTN_SECONDARY_SM}>
            {t('vitals.nextPage')}
          </button>
        </div>
      )}
    </div>
  )
}
