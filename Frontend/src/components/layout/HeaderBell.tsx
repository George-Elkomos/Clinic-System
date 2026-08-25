import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, CheckCircle, Clock, FileText, Star, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useLanguage } from '../../hooks/useLanguage'
import { pickLocalized, toIntlLocale } from '../../lib/format'
import { notificationsApi } from '../../services/notifications.api'
import { CenteredSpinner } from '../primitives/Spinner'

type NotificationCategory = 'confirmed' | 'pending' | 'feedback' | 'record' | 'neutral'

const CATEGORY_STYLE: Record<NotificationCategory, { bg: string; color: string; icon: LucideIcon }> = {
  confirmed: { bg: '#F0FDF4', color: '#16A34A', icon: CheckCircle },
  pending: { bg: '#FFF7ED', color: '#EA580C', icon: Clock },
  feedback: { bg: '#F0FDFA', color: '#0D9488', icon: Star },
  record: { bg: '#F3E8FF', color: '#9333EA', icon: FileText },
  neutral: { bg: '#F1F5F9', color: '#64748B', icon: Bell },
}

// Maps the backend's NotificationVerb values (apps/core/enums.py) onto the
// four status categories the design defines, with a neutral fallback for
// cancellations and anything else that doesn't fit one of the four.
function categoryForVerb(verb: string): NotificationCategory {
  if (verb.includes('CANCELLED')) return 'neutral'
  if (verb === 'APPT_CONFIRMED' || verb === 'APPT_REMINDER' || verb === 'PROCEDURE_SCHEDULED') return 'confirmed'
  if (verb === 'APPT_BOOKED' || verb === 'WAITLIST_OPEN' || verb === 'FOLLOWUP') return 'pending'
  if (verb === 'REVIEW' || verb === 'PROCEDURE_COMPLETED') return 'feedback'
  if (verb.includes('LAB') || verb.includes('RADIOLOGY') || verb.includes('REFERRAL') || verb === 'PATIENT_SCAN_UPLOADED') {
    return 'record'
  }
  return 'neutral'
}

function relativeTime(iso: string, locale: string) {
  const diffMin = Math.round((new Date(iso).getTime() - Date.now()) / 60_000)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, 'minute')
  const diffHour = Math.round(diffMin / 60)
  if (Math.abs(diffHour) < 24) return rtf.format(diffHour, 'hour')
  const diffDay = Math.round(diffHour / 24)
  if (Math.abs(diffDay) < 7) return rtf.format(diffDay, 'day')
  return rtf.format(Math.round(diffDay / 7), 'week')
}

// Notifications bell + popover — custom spec matching the dashboard's own
// style guide (#1E293B text, rounded-2xl, Inter), not the literal DESIGN.md
// dropdown from earlier (which this replaces). Shared by every role's shell
// header, not patient-specific despite the file's original name.
export function HeaderBell() {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const qc = useQueryClient()

  // Closes on outside click using the same mousedown-listener idiom
  // Select.tsx/AsyncCombobox.tsx and HeaderAvatarMenu use.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const { data: unread = 0 } = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: notificationsApi.unreadCount,
    refetchInterval: 30_000,
  })

  const { data: list = [], isLoading: listLoading } = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: notificationsApi.list,
    enabled: open,
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['notifications'] })
  const markAll = async () => {
    await notificationsApi.markAllRead()
    invalidate()
  }
  const markOne = async (id: number) => {
    await notificationsApi.markRead(id)
    invalidate()
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        className="patient-hover-lift relative flex h-10 w-10 items-center justify-center rounded-full border-0 bg-transparent hover:bg-bg-app"
        aria-label={t('notifications.title')}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Bell size={20} className="text-gray-500" />
        {unread > 0 && (
          <span
            className="absolute -top-1 -end-1 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-xs text-white"
            style={{ background: '#38D0CE' }}
          >
            {unread}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-x-3 top-[88px] z-50 flex max-h-[380px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10 sm:absolute sm:inset-x-auto sm:end-0 sm:top-[calc(100%+8px)] sm:w-[380px]">
          <div className="flex shrink-0 items-center justify-between border-b border-slate-100 bg-white px-5 py-3">
            <div className="flex items-center gap-2">
              <span className="text-base font-semibold" style={{ color: '#1E293B' }}>
                {t('notifications.title')}
              </span>
              {unread > 0 && (
                <span
                  className="rounded-full px-2 py-0.5 text-xs font-medium"
                  style={{ background: '#F0FDFA', color: '#0D9488' }}
                >
                  {t('notifications.unread', { count: unread })}
                </span>
              )}
            </div>
            {unread > 0 && (
              <button
                type="button"
                className="border-0 bg-transparent p-0 text-xs font-medium hover:underline"
                style={{ color: '#0284C7' }}
                onClick={() => void markAll()}
              >
                {t('notifications.markAllRead')}
              </button>
            )}
          </div>

          <div className="patient-thin-scrollbar overflow-y-auto">
            {listLoading ? (
              <CenteredSpinner />
            ) : list.length === 0 ? (
              <p className="px-5 py-6 text-sm" style={{ color: 'var(--text-secondary)' }}>
                {t('notifications.none')}
              </p>
            ) : (
              list.slice(0, 20).map((n) => {
                const style = CATEGORY_STYLE[categoryForVerb(n.verb)]
                const Icon = style.icon
                const title = pickLocalized(n.title, n.title_ar, language)
                const body = pickLocalized(n.body, n.body_ar, language)
                return (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => !n.is_read && void markOne(n.id)}
                    className={`flex w-full items-start gap-2.5 border-0 border-b border-slate-100 px-4 py-2.5 text-start transition-colors duration-150 last:border-0 ${
                      n.is_read ? 'bg-white hover:bg-slate-50/60' : 'bg-slate-50/80 hover:bg-slate-100/80'
                    }`}
                  >
                    <span
                      className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: n.is_read ? 'transparent' : '#0284C7' }}
                      aria-hidden="true"
                    />
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                      style={{ background: style.bg }}
                    >
                      <Icon size={14} style={{ color: style.color }} />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold" style={{ color: '#1E293B' }}>
                          <bdi>{title}</bdi>
                        </span>
                        <span className="shrink-0 text-[11px]" style={{ color: '#94A3B8' }}>
                          {relativeTime(n.created_at, toIntlLocale(language))}
                        </span>
                      </span>
                      <span className="text-xs leading-snug" style={{ color: '#475569' }}>
                        <bdi>{body}</bdi>
                      </span>
                    </span>
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
