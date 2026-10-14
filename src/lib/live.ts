"use client"

import type { TraceEvent } from "@/lib/types"

export interface LiveHandlers {
  onEvent?: (event: TraceEvent) => void
  onRunUpdate?: (patch: { status?: string; endedAt?: string | null }) => void
  onSubscribed?: () => void
  onError?: (message: string) => void
  onConnectionChange?: (connected: boolean) => void
}

const MAX_BACKOFF_MS = 15_000

export function liveUrl(): string {
  const override = process.env.NEXT_PUBLIC_AGENTTRACE_WS_URL
  if (override) return override
  const proto = window.location.protocol === "https:" ? "wss" : "ws"
  return `${proto}://${window.location.host}/ws`
}

/** Subscribe to one run's live events on the FastAPI `/ws` endpoint.
 * Reconnects with exponential backoff (1 s → 15 s) and re-subscribes; a
 * server `error` (unknown run, subscription cap) stops reconnecting. */
export function subscribeRun(runId: string, handlers: LiveHandlers): () => void {
  let socket: WebSocket | null = null
  let stopped = false
  let attempt = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  const connect = () => {
    const ws = new WebSocket(liveUrl())
    socket = ws
    ws.onopen = () => {
      attempt = 0
      handlers.onConnectionChange?.(true)
      ws.send(JSON.stringify({ action: "subscribe", runId }))
    }
    ws.onmessage = (message) => {
      let msg: any
      try {
        msg = JSON.parse(String(message.data))
      } catch {
        return
      }
      if (msg.type === "event") {
        if (msg.data?.runId === runId) handlers.onEvent?.(msg.data as TraceEvent)
        return
      }
      if (msg.runId !== runId) return
      if (msg.type === "subscribed") handlers.onSubscribed?.()
      else if (msg.type === "run:update") handlers.onRunUpdate?.(msg.patch ?? {})
      else if (msg.type === "error") {
        stopped = true
        handlers.onError?.(String(msg.error ?? "live updates unavailable"))
        ws.close()
      }
    }
    ws.onclose = () => {
      if (stopped) return
      handlers.onConnectionChange?.(false)
      const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt)
      attempt += 1
      timer = setTimeout(connect, delay)
    }
    ws.onerror = () => ws.close()
  }

  connect()

  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ action: "unsubscribe", runId }))
    }
    socket?.close()
  }
}
