import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FlaskConical, Image, Trash2, UploadCloud } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Breadcrumbs } from '../../components/primitives/Breadcrumbs'
import { useConfirm } from '../../components/primitives/ConfirmDialog'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { useToast } from '../../components/primitives/Toast'
import { useAuth } from '../../hooks/useAuth'
import { useLanguage } from '../../hooks/useLanguage'
import { saveBlob } from '../../lib/download'
import { formatDate } from '../../lib/format'
import { errorMessage } from '../../services/apiClient'
import { medicalApi } from '../../services/medical.api'
import type { LabResult, Scan, ScanCategory } from '../../services/types'

const SCAN_CATEGORIES: ScanCategory[] = ['XRAY', 'MRI', 'CT', 'ULTRASOUND', 'DICOM', 'OTHER']

function SectionCard({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <div id={id} className="mb-6 rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
      {children}
    </div>
  )
}

function EmptyRecordsState({
  icon,
  title,
  onAction,
  actionLabel,
}: {
  icon: React.ReactNode
  title: string
  onAction: () => void
  actionLabel: string
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-100 bg-slate-50/60 p-8 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0D9488]/10 text-[#0D9488]">
        {icon}
      </div>
      <div className="mb-1 text-sm font-semibold text-slate-700">{title}</div>
      <span className="mb-3 block max-w-xs text-xs text-slate-400">{t('medical.recordsEmptySub')}</span>
      <button
        type="button"
        onClick={onAction}
        className="cursor-pointer border-none bg-transparent p-0 text-xs font-bold text-[#0D9488] hover:underline"
      >
        {actionLabel}
      </button>
    </div>
  )
}

function FileDropzone({ file, onFileSelect }: { file: File | null; onFileSelect: (f: File | null) => void }) {
  const { t } = useTranslation()
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click() }}
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setIsDragging(false)
        const dropped = e.dataTransfer.files?.[0]
        if (dropped) onFileSelect(dropped)
      }}
      className={`my-4 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-6 text-center transition-all ${
        isDragging ? 'border-[#0D9488] bg-[#0D9488]/5' : 'border-slate-200 bg-slate-50/50 hover:border-[#0D9488] hover:bg-[#0D9488]/5'
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept=".jpg,.jpeg,.png,.pdf,.dcm,.dicom"
        onChange={(e) => onFileSelect(e.target.files?.[0] ?? null)}
      />
      <UploadCloud className="mb-2 h-10 w-10 text-[#0D9488]" aria-hidden="true" />
      {file ? (
        <>
          <span className="max-w-full truncate text-sm font-semibold text-slate-700">{file.name}</span>
          <span className="mt-1 text-xs text-slate-400">{(file.size / 1024 / 1024).toFixed(2)} MB</span>
        </>
      ) : (
        <>
          <span className="text-sm font-semibold text-slate-700">{t('medical.dropzoneLabel')}</span>
          <span className="mt-1 text-xs text-slate-400">{t('medical.fileHint')}</span>
        </>
      )}
    </div>
  )
}

function ScanRow({
  scan,
  canDelete,
  onDownload,
  onDelete,
}: {
  scan: Scan
  canDelete: boolean
  onDownload: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const { language } = useLanguage()

  return (
    <div className="mb-3 flex flex-col gap-3 rounded-xl border border-slate-100 bg-slate-50/70 p-3.5 last:mb-0 sm:flex-row sm:items-center sm:justify-between sm:p-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-[#0D9488]/10 px-2.5 py-1 text-xs font-semibold text-[#0D9488]">{scan.category}</span>
          <span className="truncate text-sm font-bold text-slate-800">{scan.original_filename}</span>
        </div>
        {scan.description && <div className="mt-1.5 text-xs text-slate-500">{scan.description}</div>}
        <div className="mt-1.5 text-xs text-slate-400">
          {formatDate(scan.created_at, language)} · {t('medical.uploadedBy', { name: scan.uploaded_by_name })}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onDownload}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#0D9488]/30 bg-[#0D9488]/5 px-3.5 text-xs font-semibold text-[#0D9488] transition-colors hover:bg-[#0D9488]/10"
        >
          <Download size={14} aria-hidden="true" />
          {t('medical.download')}
        </button>
        {canDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50/50 px-3.5 text-xs font-semibold text-rose-600 transition-colors hover:bg-rose-100"
          >
            <Trash2 size={14} aria-hidden="true" />
            {t('medical.delete')}
          </button>
        )}
      </div>
    </div>
  )
}

function LabRow({ lab }: { lab: LabResult }) {
  const { t } = useTranslation()
  const { language } = useLanguage()

  return (
    <div className="mb-3 rounded-xl border border-slate-100 bg-slate-50/70 p-3.5 last:mb-0 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold text-slate-800 sm:text-base">{lab.test_name}</span>
        {lab.is_abnormal && (
          <span className="rounded-md bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700">
            {t('lab.isAbnormal')}
          </span>
        )}
      </div>
      <div className="mt-1.5 text-xs font-medium text-slate-600 sm:text-sm">
        {[lab.result_value, lab.unit].filter(Boolean).join(' ')}
        {lab.result_date ? ` · ${formatDate(lab.result_date, language)}` : ''}
      </div>
    </div>
  )
}

export function MyScansLabsPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const qc = useQueryClient()
  const [category, setCategory] = useState<ScanCategory>('XRAY')
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

  const deleteScan = useMutation({
    mutationFn: (id: number) => medicalApi.deleteScan(id),
    onSuccess: () => {
      showToast(t('medical.scanDeleted'), 'success')
      qc.invalidateQueries({ queryKey: ['scans'] })
    },
    onError: (err) => showToast(errorMessage(err), 'error'),
  })

  const handleDelete = async (id: number, name: string) => {
    const ok = await confirm({
      title: t('medical.deleteScanTitle'),
      message: t('medical.deleteScanMessage', { name }),
      confirmLabel: t('medical.deleteScanConfirm'),
      danger: true,
    })
    if (ok) deleteScan.mutate(id)
  }

  const scrollToUpload = () => {
    document.getElementById('scan-upload-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div>
      <Breadcrumbs trail={[{ label: t('nav.scansLabs') }]} />
      {/* PatientShell already renders this same title (hidden lg:block) in its
          own sticky header — shown only below lg so the two never duplicate. */}
      <h1 className="patient-text-page-title lg:hidden" style={{ color: 'var(--text-primary)' }}>
        {t('nav.scansLabs')}
      </h1>
      <div className="mt-1 mb-6">
        <p className="text-sm text-slate-500">{t('medical.scansSubtitle')}</p>
      </div>

      <SectionCard id="scan-upload-section">
        <div className="mb-4 flex items-center gap-2 text-lg font-bold text-slate-800">
          <UploadCloud className="h-5 w-5 text-[#0D9488]" aria-hidden="true" />
          {t('medical.uploadScan')}
        </div>

        <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
          {t('medical.category')}
        </label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as ScanCategory)}
          className="patient-field rounded-xl focus:border-[#0D9488] focus:ring-2 focus:ring-[#0D9488]"
        >
          {SCAN_CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        <FileDropzone file={file} onFileSelect={setFile} />

        <button
          type="button"
          disabled={!file || upload.isPending}
          onClick={() => upload.mutate()}
          className="inline-flex items-center gap-2 rounded-xl bg-[#0D9488] border border-[#0B7A70] px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-[#0B7A70] disabled:opacity-60"
        >
          <UploadCloud size={16} aria-hidden="true" />
          {t('medical.uploadScan')}
        </button>
      </SectionCard>

      <SectionCard>
        <div className="mb-4 flex items-center gap-2 text-base font-bold text-slate-800">
          <Image className="h-5 w-5 text-[#0D9488]" aria-hidden="true" />
          {t('medical.uploadedScans')}
        </div>
        {scansLoading ? (
          <CenteredSpinner />
        ) : scans.length === 0 ? (
          <EmptyRecordsState
            icon={<Image className="h-6 w-6" aria-hidden="true" />}
            title={t('medical.noScans')}
            onAction={scrollToUpload}
            actionLabel={t('medical.goToUpload')}
          />
        ) : (
          <div>
            {scans.map((s) => (
              <ScanRow
                key={s.id}
                scan={s}
                canDelete={s.uploaded_by === user?.id}
                onDownload={() => download(s.id, s.original_filename)}
                onDelete={() => handleDelete(s.id, s.original_filename)}
              />
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard>
        <div className="mb-4 flex items-center gap-2 text-base font-bold text-slate-800">
          <FlaskConical className="h-5 w-5 text-[#0D9488]" aria-hidden="true" />
          {t('medical.labDocuments')}
        </div>
        {labsLoading ? (
          <CenteredSpinner />
        ) : labs.length === 0 ? (
          <EmptyRecordsState
            icon={<FlaskConical className="h-6 w-6" aria-hidden="true" />}
            title={t('medical.noLabs')}
            onAction={scrollToUpload}
            actionLabel={t('medical.goToUpload')}
          />
        ) : (
          <div>
            {labs.map((l) => (
              <LabRow key={l.id} lab={l} />
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  )
}
