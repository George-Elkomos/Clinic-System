import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { Button } from '../../components/primitives/Button'
import { Card } from '../../components/primitives/Card'
import { FormField } from '../../components/primitives/FormField'
import { Select } from '../../components/primitives/Select'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { useToast } from '../../components/primitives/Toast'
import { useLanguage } from '../../hooks/useLanguage'
import { saveBlob } from '../../lib/download'
import { formatDate } from '../../lib/format'
import { errorMessage } from '../../services/apiClient'
import { medicalApi } from '../../services/medical.api'

const SCAN_CATEGORIES = ['XRAY', 'MRI', 'CT', 'ULTRASOUND', 'DICOM', 'OTHER']

export function MyScansLabsPage() {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { showToast } = useToast()
  const qc = useQueryClient()
  const [category, setCategory] = useState('XRAY')
  const [file, setFile] = useState<File | null>(null)

  const { data: scans = [], isLoading: scansLoading } = useQuery({ queryKey: ['scans', 'mine'], queryFn: () => medicalApi.scans() })
  const { data: labs = [], isLoading: labsLoading } = useQuery({ queryKey: ['labs', 'mine'], queryFn: () => medicalApi.labs() })

  const upload = useMutation({
    mutationFn: () => {
      const form = new FormData()
      form.append('category', category)
      if (file) form.append('file', file)
      return medicalApi.uploadScan(form)
    },
    onSuccess: () => {
      showToast(t('medical.uploaded'), 'success')
      setFile(null)
      qc.invalidateQueries({ queryKey: ['scans'] })
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const download = async (id: number, name: string) => {
    try {
      saveBlob(await medicalApi.downloadScan(id), name || `scan-${id}`)
    } catch (err) {
      showToast(errorMessage(err), 'error')
    }
  }

  return (
    <div className="scans-page">
      <Breadcrumbs trail={[{ label: t('nav.scansLabs') }]} />
      <h1>{t('nav.scansLabs')}</h1>

      <Card title={t('medical.uploadScan')}>
        <FormField label={t('medical.category')}>
          {(p) => (
            <Select
              id={p.id}
              options={SCAN_CATEGORIES.map((c) => ({ value: c, label: c }))}
              value={category}
              onChange={(v) => setCategory(Array.isArray(v) ? 'XRAY' : String(v))}
            />
          )}
        </FormField>
        <FormField label={t('medical.file')} hint={t('medical.fileHint')}>
          {(p) => (
            <div className="file-input-wrap">
              <input {...p} type="file" accept=".jpg,.jpeg,.png,.pdf,.dcm,.dicom" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </div>
          )}
        </FormField>
        <Button loading={upload.isPending} disabled={!file} onClick={() => upload.mutate()} className="medical-upload-submit">{t('medical.uploadScan')}</Button>
      </Card>

      <Card title={t('medical.scans')}>
        {scansLoading ? <CenteredSpinner /> : scans.length === 0 ? <p>{t('medical.noScans')}</p> : (
          scans.map((s) => (
            <div key={s.id} className="appt-list-row">
              <div className="appt-list-info">
                <strong>{s.category}</strong> · {s.original_filename}
                <div className="medical-list-meta">{formatDate(s.created_at, language)} · {t('medical.uploadedBy', { name: s.uploaded_by_name })}</div>
              </div>
              <Button variant="secondary" onClick={() => download(s.id, s.original_filename)}>{t('medical.download')}</Button>
            </div>
          ))
        )}
      </Card>

      <Card title={t('medical.labs')}>
        {labsLoading ? <CenteredSpinner /> : labs.length === 0 ? <p>{t('medical.noLabs')}</p> : (
          labs.map((l) => (
            <div key={l.id} className="medical-lab-row">
              <strong>{l.test_name}</strong> {l.is_abnormal && <span className="badge badge--alert">!</span>}
              <div className="medical-list-meta">
                {l.result_value} {l.unit} · {l.result_date ? formatDate(l.result_date, language) : ''}
              </div>
            </div>
          ))
        )}
      </Card>
    </div>
  )
}
