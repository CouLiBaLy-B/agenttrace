"use client"

import { useEffect, useMemo, useRef, useState, useCallback } from "react"
import { io, Socket } from "socket.io-client"
import { TraceEvent } from "@/lib/types"
import { extractParticipants } from "./participants"
import { LifelineDiagram } from "./lifeline-diagram"
import { StackedTimeline } from "./stacked-timeline"
import { EventDetailPanel } from "./event-detail-panel"
import { ReplayControls, ReplaySpeed } from "./replay-controls"
import { useMediaQuery } from "@/lib/hooks"
import { motion, AnimatePresence } from "framer-motion"
import { Radio, Play, History, Search, PanelRightOpen, PanelRightClose } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useLayout } from "@/lib/store"

interface Props {
  runId: string
  initialEvents: TraceEvent[]
  initialStatus: "running" | "completed" | "failed"
  onRunUpdate?: (patch: any) => void
}

export function SequenceDiagram({ runId, initialEvents, initialStatus, onRunUpdate }: Props) {
  const [events, setEvents] = useState<TraceEvent[]>(initialEvents)
  const [status, setStatus] = useState(initialStatus)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [isReplay, setIsReplay] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [replayIdx, setReplayIdx] = useState(initialEvents.length - 1)
  const [replaySpeed, setReplaySpeed] = useState<ReplaySpeed>(1)
  const [connected, setConnected] = useState(false)
  const isDesktop = useMediaQuery("(min-width: 768px)")
  const isXl = useMediaQuery("(min-width: 1280px)") // xl: side panel replaces the sheet

  const scrollRef = useRef<HTMLDivElement>(null)
  const socketRef = useRef<Socket | null>(null)
  const replayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const live = status === "running"

  // ---- sync when initialEvents changes (from auto-refresh refetch) ----
  // Merge incoming events with existing ones, deduplicating by id. This keeps
  // socket-delivered live events AND picks up new events from a server refetch.
  // Skipped during replay so the scrubber position isn't disrupted.
  useEffect(() => {
    if (isReplay) return
    setEvents((prev) => {
      const byId = new Map(prev.map((e) => [e.id, e]))
      let changed = false
      for (const e of initialEvents) {
        const existing = byId.get(e.id)
        // append new events, and refresh existing ones whose tracked fields
        // changed (e.g. an llm_call backfilled with tokens/duration on completion)
        if (
          !existing ||
          existing.status !== e.status ||
          existing.durationMs !== e.durationMs ||
          JSON.stringify(existing.payload) !== JSON.stringify(e.payload)
        ) {
          byId.set(e.id, e)
          changed = true
        }
      }
      if (!changed) return prev
      // sort by seq to keep chronological order
      return [...byId.values()].sort((a, b) => a.seq - b.seq)
    })
  }, [initialEvents, isReplay])

  // sync status from parent refetch too
  useEffect(() => {
    setStatus(initialStatus)
  }, [initialStatus])

  // ---- visible events (respect replay mode) ----
  const visibleEvents = useMemo(() => {
    if (!isReplay) return events
    return events.slice(0, replayIdx + 1)
  }, [events, isReplay, replayIdx])

  const participants = useMemo(() => extractParticipants(events), [events])

  const selectedEvent = useMemo(
    () => events.find((e) => e.id === selectedId) || null,
    [events, selectedId]
  )

  // ---- socket: subscribe for live events ----
  useEffect(() => {
    if (!live) return
    const sock = io("/?XTransformPort=3003", {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    })
    socketRef.current = sock
    sock.on("connect", () => {
      setConnected(true)
      sock.emit("subscribe", { runId })
    })
    sock.on("disconnect", () => setConnected(false))
    sock.on("event", (ev: TraceEvent) => {
      setEvents((prev) => {
        if (prev.some((p) => p.id === ev.id)) return prev
        return [...prev, ev]
      })
    })
    sock.on("run:update", (payload: { runId: string; patch: any }) => {
      if (payload.runId !== runId) return
      if (payload.patch?.status) {
        setStatus(payload.patch.status)
        onRunUpdate?.(payload.patch)
      }
    })
    return () => {
      sock.emit("unsubscribe", { runId })
      sock.disconnect()
      socketRef.current = null
    }
  }, [runId, live, onRunUpdate])

  // ---- auto-scroll to newest on live events ----
  useEffect(() => {
    if (isReplay) return
    const el = scrollRef.current
    if (!el) return
    // scroll the inner svg container
    const target = el.querySelector(".at-scroll") as HTMLElement | null
    const scroller = target || el
    const nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 200
    if (nearBottom) {
      scroller.scrollTop = scroller.scrollHeight
    }
  }, [visibleEvents, isReplay])

  // ---- replay playback scheduler ----
  useEffect(() => {
    if (!isReplay || !isPlaying || replaySpeed === 0) return
    if (replayIdx >= events.length - 1) return
    const cur = events[replayIdx]
    const next = events[replayIdx + 1]
    const gap = Math.max(
      80,
      (new Date(next.timestamp).getTime() - new Date(cur.timestamp).getTime()) / replaySpeed
    )
    const atEnd = replayIdx + 1 >= events.length - 1
    replayTimerRef.current = setTimeout(() => {
      setReplayIdx((i) => Math.min(i + 1, events.length - 1))
      if (atEnd) setIsPlaying(false)
    }, Math.min(gap, 5000))
    return () => {
      if (replayTimerRef.current) clearTimeout(replayTimerRef.current)
    }
  }, [isReplay, isPlaying, replayIdx, replaySpeed, events])

  const enterReplay = useCallback(() => {
    setIsReplay(true)
    setIsPlaying(false)
    setReplayIdx(events.length - 1)
  }, [events.length])

  const exitReplay = useCallback(() => {
    setIsReplay(false)
    setIsPlaying(false)
  }, [])

  const togglePlay = useCallback(() => {
    if (!isReplay) return
    // instant speed → jump straight to the end
    if (replaySpeed === 0) {
      setReplayIdx(events.length - 1)
      setIsPlaying(false)
      return
    }
    if (replayIdx >= events.length - 1) setReplayIdx(0)
    setIsPlaying((p) => !p)
  }, [isReplay, replayIdx, replaySpeed, events.length])

  const handleSpeed = useCallback(
    (s: ReplaySpeed) => {
      setReplaySpeed(s)
      if (s === 0) {
        setReplayIdx(events.length - 1)
        setIsPlaying(false)
      }
    },
    [events.length]
  )

  const seek = useCallback(
    (idx: number) => {
      setReplayIdx(Math.max(0, Math.min(idx, events.length - 1)))
      setIsPlaying(false)
    },
    [events.length]
  )

  // detail panel collapse (persisted in the layout store; shared with EventDetailPanel)
  const { detailCollapsed, setDetailCollapsed, toggleDetail } = useLayout()

  // selecting an event auto-expands the detail panel
  const handleSelect = useCallback((id: string) => {
    setSelectedId(id)
    if (detailCollapsed) setDetailCollapsed(false)
  }, [detailCollapsed, setDetailCollapsed])

  const progress = events.length > 1 ? replayIdx / (events.length - 1) : 1

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card/40 flex-wrap">
        <div className="flex items-center gap-2 mr-auto">
          {live ? (
            <span className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-widest text-primary">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-60 at-pulse-ring" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
              </span>
              {connected ? "listening" : "connecting…"}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
              <Radio className="h-3.5 w-3.5" />
              {events.length} events · {status}
            </span>
          )}
        </div>

        {/* detail panel toggle (desktop only) */}
        <Button
          variant="ghost"
          size="icon"
          className="hidden xl:flex h-8 w-8 text-muted-foreground hover:text-foreground"
          title={detailCollapsed ? "Show event panel" : "Hide event panel"}
          onClick={toggleDetail}
        >
          {detailCollapsed ? <PanelRightOpen className="h-4 w-4" /> : <PanelRightClose className="h-4 w-4" />}
        </Button>

        {!isReplay ? (
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={enterReplay} disabled={events.length < 2}>
            <History className="h-3.5 w-3.5" />
            Replay
          </Button>
        ) : (
          <ReplayControls
            isReplay={isReplay}
            isPlaying={isPlaying}
            progress={progress}
            currentIdx={replayIdx}
            total={events.length}
            speed={replaySpeed}
            onTogglePlay={togglePlay}
            onSeek={seek}
            onSpeed={handleSpeed}
            onExit={exitReplay}
          />
        )}
      </div>

      {/* canvas + detail panel (side panel on desktop, sheet on mobile) */}
      <div className="flex-1 min-h-0 flex">
        {/* canvas — the auto-scroll target lives inside here */}
        <div ref={scrollRef} className="flex-1 min-w-0 h-full relative">
          {events.length === 0 ? (
            <ListeningState runId={runId} live={live} />
          ) : isDesktop ? (
            <LifelineDiagram
              events={visibleEvents}
              participants={participants}
              selectedId={selectedId}
              onSelect={handleSelect}
              live={live && !isReplay}
            />
          ) : (
            <StackedTimeline
              events={visibleEvents}
              participants={participants}
              selectedId={selectedId}
              onSelect={handleSelect}
            />
          )}
        </div>

        {/* desktop side panel — self-collapsing + resizable (xl only), persisted via useLayout */}
        <EventDetailPanel
          event={selectedEvent}
          participants={participants}
          onClose={() => setSelectedId(null)}
          variant="panel"
        />
      </div>

      {/* mobile/tablet sheet detail — desktop (xl) uses the side panel instead */}
      {!isXl && (
        <EventDetailPanel
          event={selectedEvent}
          participants={participants}
          onClose={() => setSelectedId(null)}
          variant="sheet"
        />
      )}
    </div>
  )
}

function ListeningState({ runId, live }: { runId: string; live: boolean }) {
  return (
    <div className="h-full at-graticule at-scanlines relative flex flex-col items-center justify-center p-6 text-center overflow-hidden">
      <AnimatePresence>
        <motion.div
          key="scope"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="relative"
        >
          {/* radar-style sweep */}
          <div className="relative h-40 w-40 rounded-full border border-primary/30 flex items-center justify-center">
            <div className="absolute inset-2 rounded-full border border-primary/20" />
            <div className="absolute inset-6 rounded-full border border-primary/15" />
            <div className="absolute inset-0 rounded-full overflow-hidden">
              <div
                className="at-radar-sweep absolute top-1/2 left-1/2 h-1/2 w-1/2 origin-top-left"
                style={{
                  background: "linear-gradient(to right, oklch(0.78 0.17 155 / 0.35), transparent)",
                  clipPath: "polygon(0 0, 100% 0, 0 100%)",
                }}
              />
            </div>
            <div className="h-2 w-2 rounded-full bg-primary at-glow" />
          </div>
        </motion.div>
      </AnimatePresence>

      <p className="mt-6 font-mono text-sm text-primary at-glow uppercase tracking-widest">
        {live ? "listening for your agent's first event" : "no events recorded"}
      </p>
      <p className="mt-2 text-xs text-muted-foreground max-w-sm">
        {live
          ? "Point your agent at the ingestion endpoint below. The first event will render here the instant it arrives."
          : "This run has no events. Start a new run or send events via the ingestion API."}
      </p>
      <div className="mt-4 rounded-md border border-border bg-background/60 px-3 py-2 font-mono text-[11px] text-muted-foreground">
        POST /api/events <span className="text-primary/70">· run {runId.slice(0, 8)}…</span>
      </div>
    </div>
  )
}
