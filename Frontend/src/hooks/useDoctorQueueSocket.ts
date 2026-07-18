import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { tokenStore } from '../lib/tokenStore'

const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 15000

/**
 * Live-updates the doctor queue page: a WebSocket push ("something changed")
 * triggers a refetch of the existing REST queue endpoint — no polling. The
 * socket carries no queue data itself, so a missed/duplicate push is harmless;
 * losing the connection entirely just means a stale screen until it reconnects,
 * which is why every reconnect (not just the first connect) forces one resync.
 */
export function useDoctorQueueSocket() {
  const qc = useQueryClient()

  useEffect(() => {
    let socket: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let stopped = false
    let attempt = 0
    let everConnected = false

    const resync = () => {
      qc.invalidateQueries({ queryKey: ['doctor-queue'] })
      qc.invalidateQueries({ queryKey: ['doctor-queue-in-progress'] })
    }

    const connect = () => {
      if (stopped) return
      const token = tokenStore.get()
      if (!token) {
        reconnectTimer = setTimeout(connect, RECONNECT_BASE_MS)
        return
      }

      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      socket = new WebSocket(
        `${proto}//${window.location.host}/ws/appointments/queue/?token=${encodeURIComponent(token)}`,
      )

      socket.onopen = () => {
        attempt = 0
        // A reconnect (dropped socket, brief server restart) may have missed
        // pushes in between — resync once. Skip on the very first connect;
        // the page's own initial query fetch already covers that.
        if (everConnected) resync()
        everConnected = true
      }

      socket.onmessage = (event) => {
        try {
          if (JSON.parse(event.data)?.type === 'queue_updated') resync()
        } catch {
          // ignore malformed frames
        }
      }

      socket.onclose = () => {
        if (stopped) return
        const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempt)
        attempt += 1
        reconnectTimer = setTimeout(connect, delay)
      }

      socket.onerror = () => socket?.close()
    }

    connect()

    return () => {
      stopped = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      socket?.close()
    }
  }, [qc])
}
