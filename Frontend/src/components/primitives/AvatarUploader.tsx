import { Camera, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useToast } from './Toast'

const MAX_FILE_BYTES = 5 * 1024 * 1024

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

interface AvatarUploaderProps {
  /** Used for the initials fallback and the image's alt text. */
  name: string
  /** The currently saved photo URL, or null if none. */
  imageUrl: string | null
  /** Tri-state: undefined = unchanged, File = new upload pending, null = removal pending. */
  value: File | null | undefined
  onChange: (value: File | null | undefined) => void
  size?: number
}

// Holds the picked File locally and reports it up via onChange — the parent
// page includes it in its own save payload (FormData) rather than this
// component uploading on pick, matching the existing CreateDoctorPage pattern.
export function AvatarUploader({ name, imageUrl, value, onChange, size = 88 }: AvatarUploaderProps) {
  const { t } = useTranslation()
  const { showToast } = useToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!(value instanceof File)) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(value)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [value])

  const removed = value === null
  const displayUrl = removed ? null : (previewUrl ?? imageUrl)
  const hasPhoto = !!displayUrl

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      showToast(t('profile.avatarInvalidType'), 'error')
      return
    }
    if (file.size > MAX_FILE_BYTES) {
      showToast(t('profile.avatarTooLarge'), 'error')
      return
    }
    onChange(file)
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div
        className="flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-teal-100 font-semibold text-teal-700"
        style={{ width: size, height: size, fontSize: size / 3 }}
      >
        {displayUrl ? (
          <img src={displayUrl} alt={name} className="h-full w-full object-cover" />
        ) : (
          <span>{initials(name)}</span>
        )}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow-sm transition-all hover:bg-slate-50 sm:text-sm"
        >
          <Camera size={14} />
          {hasPhoto ? t('profile.changePhoto') : t('profile.uploadPhoto')}
        </button>
        {hasPhoto && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-transparent bg-transparent px-4 py-2 text-xs font-semibold text-rose-600 transition-all hover:bg-rose-50 sm:text-sm"
          >
            <Trash2 size={14} />
            {t('profile.removePhoto')}
          </button>
        )}
      </div>
    </div>
  )
}
