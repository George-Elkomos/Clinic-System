import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { Button } from '../primitives/Button'
import { CenteredSpinner } from '../primitives/Spinner'
import { Modal } from '../primitives/Modal'
import { StatusBadge } from '../primitives/StatusBadge'
import { useToast } from '../primitives/Toast'
import { useAuth } from '../../hooks/useAuth'
import { useLanguage } from '../../hooks/useLanguage'
import { formatDateTime } from '../../lib/format'
import { errorMessage } from '../../services/apiClient'
import { proceduresApi } from '../../services/procedures.api'
import type { ClinicalProcedure } from '../../services/types'
import { ProcedureChecklist } from './ProcedureChecklist'

interface Props {
  procedureId: number
  onClose: () => void
  onChanged?: () => void
}

export function ProcedureDetailModal({ procedureId, onClose, onChanged }: Props) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { language } = useLanguage()
  const { showToast } = useToast()
  const qc = useQueryClient()
  const [postNotesDraft, setPostNotesDraft] = useState('')
  const [complicationsDraft, setComplicationsDraft] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  // Mirrors procedure.checklist_state locally so rapid consecutive toggles each
  // build on the latest click rather than a snapshot from before earlier
  // in-flight PATCH requests resolved — otherwise a fast second toggle can
  // silently roll back the first (see functional setChecklist in handleToggle).
  const [checklist, setChecklist] = useState<ClinicalProcedure['checklist_state'] | null>(null)

  const { data: procedure } = useQuery({
    queryKey: ['procedure', procedureId],
    queryFn: () => proceduresApi.get(procedureId),
  })

  // Hydrate the local checklist once when the procedure first loads (this
  // component remounts fresh per procedureId, so a single hydration is safe —
  // see the "adjusting state when a prop changes" pattern from the React docs).
  if (procedure && checklist === null) {
    setChecklist(procedure.checklist_state)
  }

  const applyUpdate = (updated: ClinicalProcedure) => {
    qc.setQueryData(['procedure', procedureId], updated)
    onChanged?.()
  }
  const showError = (err: unknown) => showToast(errorMessage(err), 'error')

  const toggleChecklist = useMutation({
    mutationFn: (checklist_state: ClinicalProcedure['checklist_state']) =>
      proceduresApi.update(procedureId, { checklist_state }),
    onSuccess: applyUpdate,
    onError: showError,
  })

  const savePreNotes = useMutation({
    mutationFn: (pre_procedure_notes: string) => proceduresApi.update(procedureId, { pre_procedure_notes }),
    onSuccess: applyUpdate,
    onError: showError,
  })

  const start = useMutation({
    mutationFn: () => proceduresApi.start(procedureId),
    onSuccess: (updated) => { applyUpdate(updated); showToast(t('procedures.started'), 'success') },
    onError: showError,
  })

  const complete = useMutation({
    mutationFn: () =>
      proceduresApi.complete(procedureId, {
        post_procedure_notes: postNotesDraft || undefined,
        complications: complicationsDraft || undefined,
      }),
    onSuccess: (updated) => { applyUpdate(updated); showToast(t('procedures.completed'), 'success') },
    onError: showError,
  })

  const cancel = useMutation({
    mutationFn: () => proceduresApi.cancel(procedureId, cancelReason),
    onSuccess: (updated) => {
      applyUpdate(updated)
      setCancelling(false)
      showToast(t('procedures.cancelled'), 'success')
    },
    onError: showError,
  })

  if (!procedure) {
    return (
      <Modal title={t('procedures.title')} onClose={onClose}>
        <CenteredSpinner />
      </Modal>
    )
  }

  const isOwner = !!user?.doctor_profile?.id && procedure.doctor === user.doctor_profile.id
  const canAct = isOwner && (procedure.status === 'SCHEDULED' || procedure.status === 'IN_PROGRESS')
  const isTerminal = procedure.status === 'COMPLETED' || procedure.status === 'CANCELLED'
  const displayName = language === 'ar' && procedure.procedure_name_ar ? procedure.procedure_name_ar : procedure.procedure_name

  const handleToggle = (idx: number) => {
    setChecklist((prev) => {
      if (!prev) return prev
      const next = prev.map((step, i) => (i === idx ? { ...step, completed: !step.completed } : step))
      toggleChecklist.mutate(next)
      return next
    })
  }

  return (
    <Modal title={displayName} onClose={onClose} wide>
      <div className="procedure-detail__head">
        <StatusBadge status={procedure.status} ns="procedures.status" />
        {procedure.template_detail && <span className="badge">{procedure.template_detail.category}</span>}
      </div>

      <div className="procedure-detail__timer">
        <span>{t('procedures.startedAt')}: {procedure.start_time ? formatDateTime(procedure.start_time, language) : '—'}</span>
        <span>{t('procedures.endedAt')}: {procedure.end_time ? formatDateTime(procedure.end_time, language) : '—'}</span>
      </div>

      {procedure.status === 'CANCELLED' && procedure.cancellation_reason && (
        <p className="encounter-rx-item__reason">
          {t('procedures.cancelledReason', { reason: procedure.cancellation_reason })}
        </p>
      )}

      <h3 className="medical-section-divider">{t('procedures.checklist')}</h3>
      <ProcedureChecklist
        items={checklist ?? procedure.checklist_state}
        onToggle={handleToggle}
        disabled={!isOwner || procedure.status !== 'IN_PROGRESS'}
      />

      <h3 className="medical-section-divider">{t('procedures.preProcedureNotes')}</h3>
      <textarea
        rows={2}
        defaultValue={procedure.pre_procedure_notes}
        disabled={!isOwner || isTerminal}
        placeholder={t('procedures.preProcedureNotesHint')}
        onBlur={(e) => {
          if (e.target.value !== procedure.pre_procedure_notes) savePreNotes.mutate(e.target.value)
        }}
      />

      {procedure.status === 'IN_PROGRESS' && (
        <>
          <h3 className="medical-section-divider">{t('procedures.postProcedureNotes')}</h3>
          <textarea
            rows={2}
            value={postNotesDraft || procedure.post_procedure_notes}
            onChange={(e) => setPostNotesDraft(e.target.value)}
            placeholder={t('procedures.postProcedureNotesRequired')}
          />
          <h3 className="medical-section-divider">{t('procedures.complications')}</h3>
          <textarea
            rows={2}
            value={complicationsDraft || procedure.complications}
            onChange={(e) => setComplicationsDraft(e.target.value)}
            placeholder={t('procedures.complicationsHint')}
          />
        </>
      )}

      {procedure.status === 'COMPLETED' && (
        <>
          <h3 className="medical-section-divider">{t('procedures.postProcedureNotes')}</h3>
          <p>{procedure.post_procedure_notes}</p>
          {procedure.complications && (
            <>
              <h3 className="medical-section-divider">{t('procedures.complications')}</h3>
              <p>{procedure.complications}</p>
            </>
          )}
        </>
      )}

      {cancelling && (
        <div className="procedure-cancel-form">
          <textarea
            rows={2}
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder={t('procedures.cancelReasonPlaceholder')}
          />
          <div className="procedure-cancel-actions">
            <Button variant="secondary" onClick={() => setCancelling(false)}>{t('encounters.cancel')}</Button>
            <Button
              variant="danger"
              loading={cancel.isPending}
              disabled={cancelReason.trim().length < 3}
              onClick={() => cancel.mutate()}
            >
              {t('procedures.confirmCancelBtn')}
            </Button>
          </div>
        </div>
      )}

      {canAct && !cancelling && (
        <div className="procedure-detail__actions">
          <Button variant="secondary" onClick={() => setCancelling(true)}>{t('procedures.cancelProcedure')}</Button>
          {procedure.status === 'SCHEDULED' && (
            <Button loading={start.isPending} onClick={() => start.mutate()}>{t('procedures.start')}</Button>
          )}
          {procedure.status === 'IN_PROGRESS' && (
            <Button
              loading={complete.isPending}
              disabled={!(postNotesDraft || procedure.post_procedure_notes).trim()}
              onClick={() => complete.mutate()}
            >
              {t('procedures.complete')}
            </Button>
          )}
        </div>
      )}
    </Modal>
  )
}
