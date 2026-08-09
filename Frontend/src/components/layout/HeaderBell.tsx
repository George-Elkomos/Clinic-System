import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, CheckCircle, Clock, FileText, Star, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useLanguage } from '../../hooks/useLanguage'
import { notificationsApi } from '../../services/notifications.api'

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
  const qc = useQueryClient()

  const { data: unread = 0 } = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: notificationsApi.unreadCount,
    refetchInterval: 30_000,
  })

  const { data: list = [] } = useQuery({
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
    <div className="relative">
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
        <div className="absolute end-0 top-[calc(100%+8px)] z-50 flex max-h-[480px] w-[380px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10">
          <div className="flex shrink-0 items-center justify-between border-b border-slate-100 bg-white px-5 py-4">
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
            {list.length === 0 ? (
              <p className="px-5 py-6 text-sm" style={{ color: 'var(--text-secondary)' }}>
                {t('notifications.none')}
              </p>
            ) : (
              list.slice(0, 20).map((n) => {
                const style = CATEGORY_STYLE[categoryForVerb(n.verb)]
                const Icon = style.icon
                const title = language === 'ar' && n.title_ar ? n.title_ar : n.title
                const body = language === 'ar' && n.body_ar ? n.body_ar : n.body
                return (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => !n.is_read && void markOne(n.id)}
                    className={`flex w-full items-start gap-3.5 border-0 border-b border-slate-100 px-5 py-3.5 text-start transition-colors duration-150 last:border-0 ${
                      n.is_read ? 'bg-white hover:bg-slate-50/60' : 'bg-slate-50/80 hover:bg-slate-100/80'
                    }`}
                  >
                    <span
                      className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: n.is_read ? 'transparent' : '#0284C7' }}
                      aria-hidden="true"
                    />
                    <span
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                      style={{ background: style.bg }}
                    >
                      <Icon size={16} style={{ color: style.color }} />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold" style={{ color: '#1E293B' }}>
                          {title}
                        </span>
                        <span className="shrink-0 text-[11px]" style={{ color: '#94A3B8' }}>
                          {relativeTime(n.created_at, language)}
                        </span>
                      </span>
                      <span className="text-xs leading-relaxed" style={{ color: '#475569' }}>
                        {body}
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
