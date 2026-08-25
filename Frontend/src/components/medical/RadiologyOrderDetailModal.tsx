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
import { errorMessage } from '../../services/apiClient'
import { saveBlob } from '../../lib/download'
import { formatDateTime } from '../../lib/format'
import { medicalApi } from '../../services/medical.api'
import { radiologyApi } from '../../services/radiology.api'
import type { RadiologyOrder } from '../../services/types'

interface Props {
  orderId: number
  onClose: () => void
  onChanged?: () => void
}

export function RadiologyOrderDetailModal({ orderId, onClose, onChanged }: Props) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { language } = useLanguage()
  const { showToast } = useToast()
  const qc = useQueryClient()

  const [file, setFile] = useState<File | null>(null)
  const [description, setDescription] = useState('')
  const [reporting, setReporting] = useState(false)
  const [findings, setFindings] = useState('')
  const [impression, setImpression] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const [cancelReason, setCancelReason] = useState('')

  const { data: order } = useQuery({
    queryKey: ['radiology-order', orderId],
    queryFn: () => radiologyApi.get(orderId),
  })

  // Scans are only readable by PATIENT/DOCTOR/MANAGER (secretaries have no
  // medical-data read access), so skip the lookup entirely for that role
  // rather than surfacing a 403 toast on every completed/reported order.
  const canViewScan = !!order && (order.status === 'COMPLETED' || order.status === 'REPORTED') && user?.role !== 'SECRETARY'
  const { data: scans = [] } = useQuery({
    queryKey: ['scans', order?.patient],
    queryFn: () => medicalApi.scans(order!.patient),
    enabled: canViewScan,
  })
  const linkedScan = scans.find((s) => s.radiology_order === orderId)

  const applyUpdate = (updated: RadiologyOrder) => {
    qc.setQueryData(['radiology-order', orderId], updated)
    onChanged?.()
  }
  const showError = (err: unknown) => showToast(errorMessage(err), 'error')

  const complete = useMutation({
    mutationFn: () => radiologyApi.complete(orderId, file as File, description || undefined),
    onSuccess: (updated) => {
      applyUpdate(updated)
      setFile(null)
      setDescription('')
      showToast(t('radiology.completed'), 'success')
    },
    onError: showError,
  })

  const report = useMutation({
    mutationFn: () => radiologyApi.report(orderId, { findings, impression }),
    onSuccess: (updated) => {
      applyUpdate(updated)
      setReporting(false)
      showToast(t('radiology.reported'), 'success')
    },
    onError: showError,
  })

  const cancel = useMutation({
    mutationFn: () => radiologyApi.cancel(orderId, cancelReason),
    onSuccess: (updated) => {
      applyUpdate(updated)
      setCancelling(false)
      showToast(t('radiology.cancelled'), 'success')
    },
    onError: showError,
  })

  const downloadScan = async () => {
    if (!linkedScan) return
    try {
      saveBlob(await medicalApi.downloadScan(linkedScan.id), linkedScan.original_filename || `scan-${linkedScan.id}`)
    } catch (err) {
      showToast(errorMessage(err), 'error')
    }
  }

  if (!order) {
    return (
      <Modal title={t('radiology.title')} onClose={onClose}>
        <CenteredSpinner />
      </Modal>
    )
  }

  const isOrderingDoctor = !!user?.doctor_profile?.id && order.doctor === user.doctor_profile.id
  const isDoctor = user?.role === 'DOCTOR'
  const isSecretary = user?.role === 'SECRETARY'
  const isManager = user?.role === 'MANAGER'

  const canComplete = order.status === 'ORDERED' && (isSecretary || isManager || (isDoctor && isOrderingDoctor))
  const canReport = order.status === 'COMPLETED' && ((isDoctor && isOrderingDoctor) || isManager)
  const canCancel = (order.status === 'ORDERED' || order.status === 'COMPLETED') && ((isDoctor && isOrderingDoctor) || isManager)
  const showingForm = reporting || cancelling

  const displayName = language === 'ar' && order.study_name_ar ? order.study_name_ar : order.study_name

  return (
    <Modal title={displayName || order.accession_number} onClose={onClose} wide>
      <div className="procedure-detail__head">
        <StatusBadge status={order.status} ns="radiology.status" />
        {order.priority !== 'ROUTINE' && <StatusBadge status={order.priority} ns="status" />}
        <span className="badge">{order.accession_number}</span>
      </div>

      <div className="procedure-detail__timer">
        <span>{order.patient_name} · {order.doctor_name}</span>
        <span>{formatDateTime(order.created_at, language)}</span>
      </div>

      {order.clinical_reason && (
        <>
          <h3 className="medical-section-divider">{t('radiology.clinicalReason')}</h3>
          <p>{order.clinical_reason}</p>
        </>
      )}

      {order.template_detail?.instructions && (
        <>
          <h3 className="medical-section-divider">{t('radiology.instructions')}</h3>
          <p>{order.template_detail.instructions}</p>
        </>
      )}

      {order.status === 'CANCELLED' && order.cancellation_reason && (
        <p className="encounter-rx-item__reason">
          {t('radiology.cancellationReason', { reason: order.cancellation_reason })}
        </p>
      )}

      {(order.status === 'REPORTED' || (order.status === 'COMPLETED' && !canReport)) && (order.findings || order.impression) && (
        <>
          <h3 className="medical-section-divider">{t('radiology.findings')}</h3>
          <p>{order.findings || '—'}</p>
          <h3 className="medical-section-divider">{t('radiology.impression')}</h3>
          <p>{order.impression || '—'}</p>
        </>
      )}

      {canViewScan && linkedScan && (
        <>
          {linkedScan.description && (
            <>
              <h3 className="medical-section-divider">{t('radiology.description')}</h3>
              <p>{linkedScan.description}</p>
            </>
          )}
          <div style={{ marginTop: 'var(--space-3)' }}>
            <Button variant="secondary" onClick={downloadScan}>{t('radiology.viewScan')}</Button>
          </div>
        </>
      )}

      {canComplete && !showingForm && (
        <>
          <h3 className="medical-section-divider">{t('radiology.complete')}</h3>
          <div className="file-input-wrap">
            <input
              type="file"
              accept=".jpg,.jpeg,.png,.pdf,.dcm,.dicom"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('radiology.description')}
          />
        </>
      )}

      {reporting && (
        <div className="procedure-cancel-form">
          <h3 className="medical-section-divider">{t('radiology.findings')}</h3>
          <textarea rows={2} value={findings} onChange={(e) => setFindings(e.target.value)} />
          <h3 className="medical-section-divider">{t('radiology.impression')}</h3>
          <textarea rows={2} value={impression} onChange={(e) => setImpression(e.target.value)} />
          <div className="procedure-cancel-actions">
            <Button variant="secondary" onClick={() => setReporting(false)}>{t('encounters.cancel')}</Button>
            <Button
              loading={report.isPending}
              disabled={!findings.trim() || !impression.trim()}
              onClick={() => report.mutate()}
            >
              {t('radiology.report')}
            </Button>
          </div>
        </div>
      )}

      {cancelling && (
        <div className="procedure-cancel-form">
          <textarea
            rows={2}
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder={t('radiology.cancelReasonPlaceholder')}
          />
          <div className="procedure-cancel-actions">
            <Button variant="secondary" onClick={() => setCancelling(false)}>{t('encounters.cancel')}</Button>
            <Button
              variant="danger"
              loading={cancel.isPending}
              disabled={cancelReason.trim().length < 3}
              onClick={() => cancel.mutate()}
            >
              {t('radiology.confirmCancelBtn')}
            </Button>
          </div>
        </div>
      )}

      {!showingForm && (canComplete || canReport || canCancel) && (
        <div className="procedure-detail__actions">
          {canCancel && (
            <Button variant="secondary" onClick={() => setCancelling(true)}>{t('radiology.cancelOrder')}</Button>
          )}
          {canReport && (
            <Button onClick={() => setReporting(true)}>{t('radiology.report')}</Button>
          )}
          {canComplete && (
            <Button loading={complete.isPending} disabled={!file} onClick={() => complete.mutate()}>
              {t('radiology.complete')}
            </Button>
          )}
        </div>
      )}
    </Modal>
  )
}
