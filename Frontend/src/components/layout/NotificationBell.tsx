import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { notificationsApi } from '../../services/notifications.api'

export function NotificationBell() {
  const { t } = useTranslation()
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

  const markAll = async () => {
    await notificationsApi.markAllRead()
    qc.invalidateQueries({ queryKey: ['notifications'] })
  }

  return (
    <div className="bell">
      <button
        type="button"
        className="btn btn--secondary"
        style={{ minHeight: 44, padding: '4px 14px' }}
        aria-label={t('notifications.title')}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        🔔
        {unread > 0 && <span className="bell__count" aria-hidden="true">{unread}</span>}
      </button>
      {open && (
        <div className="bell__panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <strong>{t('notifications.title')}</strong>
            {list.length > 0 && (
              <button type="button" className="btn btn--secondary" style={{ minHeight: 36, padding: '2px 10px', fontSize: 14 }} onClick={markAll}>
                {t('notifications.markAllRead')}
              </button>
            )}
          </div>
          {list.length === 0 ? (
            <p>{t('notifications.none')}</p>
          ) : (
            list.slice(0, 10).map((n) => (
              <div key={n.id} className="bell__item">
                <strong>{n.title}</strong>
                <span>{n.body}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
