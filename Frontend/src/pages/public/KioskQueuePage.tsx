import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'

import { KioskLayout } from '../../components/layout/KioskLayout'
import { CenteredSpinner } from '../../components/primitives/Spinner'
import { useLanguage } from '../../hooks/useLanguage'
import { formatTime } from '../../lib/format'
import { kioskApi } from '../../services/appointments.api'
import type { KioskRow } from '../../services/types'

function QueueRow({ row, big }: { row: KioskRow; big?: boolean }) {
  const { t } = useTranslation()
  const { language } = useLanguage()
  return (
    <div
      className="card"
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 'var(--space-3)',
        borderInlineStart: row.is_emergency ? '8px solid var(--danger)' : undefined,
      }}
    >
      <div>
        <div style={{ fontSize: big ? 48 : 28, fontWeight: 700 }}>{row.display_name}</div>
        <div style={{ color: 'var(--text-muted)' }}>{formatTime(row.scheduled_start, language)}</div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {row.is_emergency && <span className="badge badge--alert">{t('kiosk.emergency')}</span>}
        {row.is_walk_in && <span className="badge">{t('kiosk.walkIn')}</span>}
      </div>
    </div>
  )
}

export function KioskQueuePage() {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { doctorId } = useParams()
  const id = Number(doctorId)

  const { data, isLoading, isError, dataUpdatedAt } = useQuery({
    queryKey: ['kiosk', id],
    queryFn: () => kioskApi.queue(id),
    refetchInterval: 30_000, // auto-refresh every 30 seconds
  })

  return (
    <KioskLayout>
      {isLoading ? (
        <CenteredSpinner />
      ) : isError || !data ? (
        <p>{t('errors.generic')}</p>
      ) : (
        <div className="container">
          <h1 style={{ fontSize: 40 }}>
            {data.doctor.name}
            {data.doctor.room_number && (
              <span style={{ color: 'var(--text-muted)', fontSize: 24 }}>
                {' '}· {t('kiosk.room', { room: data.doctor.room_number })}
              </span>
            )}
          </h1>

          <h2>{t('kiosk.nowServing')}</h2>
          {data.now_serving ? (
            <QueueRow row={data.now_serving} big />
          ) : (
            <p style={{ fontSize: 28, color: 'var(--text-muted)' }}>{t('common.none')}</p>
          )}

          <h2>{t('kiosk.upNext')}</h2>
          {data.queue.length === 0 ? (
            <p style={{ fontSize: 24 }}>{t('kiosk.noOne')}</p>
          ) : (
            data.queue.map((row, i) => <QueueRow key={i} row={row} />)
          )}

          <p style={{ color: 'var(--text-muted)', marginTop: 'var(--space-5)' }}>
            {t('kiosk.waiting', { count: data.waiting_count })} ·{' '}
            {t('kiosk.updated', { time: formatTime(new Date(dataUpdatedAt).toISOString(), language) })}
          </p>
        </div>
      )}
    </KioskLayout>
  )
}
