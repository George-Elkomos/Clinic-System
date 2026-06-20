import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { Button } from '../primitives/Button'
import { CenteredSpinner } from '../primitives/Spinner'
import { useToast } from '../primitives/Toast'
import { useConfirm } from '../primitives/ConfirmDialog'
import { VitalSignsCard } from './VitalSignsCard'
import { VitalSignsForm } from './VitalSignsForm'
import { useAuth } from '../../hooks/useAuth'
import { vitalsApi } from '../../services/vitals.api'
import { errorMessage } from '../../services/apiClient'
import type { VitalSigns } from '../../services/types'

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
  if (isError) return <p className="vitals-history__empty">{t('vitals.loadError')}</p>

  const records = data?.results ?? []
  const totalPages = data ? Math.ceil(data.count / PAGE_SIZE) : 1

  if (records.length === 0 && page === 1) {
    return <p className="vitals-history__empty">{t('vitals.noHistory')}</p>
  }

  return (
    <div>
      {records.map((record) => (
        <div key={record.id}>
          {editing?.id === record.id ? (
            <div style={{ marginBottom: 'var(--space-4)', padding: 'var(--space-4)', background: 'var(--surface)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
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
              onEdit={readOnly ? undefined : () => setEditing(record)}
              onDelete={readOnly || !canDelete ? undefined : () => handleDelete(record)}
            />
          )}
        </div>
      ))}

      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', justifyContent: 'center', marginTop: 'var(--space-4)' }}>
          <Button variant="secondary" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
            ‹
          </Button>
          <span>{t('vitals.page')} {page} {t('vitals.of')} {totalPages}</span>
          <Button variant="secondary" disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>
            ›
          </Button>
        </div>
      )}
    </div>
  )
}
