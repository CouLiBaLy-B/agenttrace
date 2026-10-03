"use client"

import { useEffect, useMemo, useRef, useState, useCallback } from "react"
import { subscribeRun } from "@/lib/live"
import { api } from "@/lib/api"
import { TraceEvent } from "@/lib/types"
import { extractParticipants } from "./participants"
import { LifelineDiagram } from "./lifeline-diagram"
import { StackedTimeline } from "./stacked-timeline"
import { EventDetailPanel } from "./event-detail-panel"
import { ReplayControls, ReplaySpeed } from "./replay-controls"
import { useMediaQuery } from "@/lib/hooks"
import { motion, AnimatePresence } from "framer-motion"
import { Radio, Play, History, Search } from "lucide-react"
import { Button } from "@/components/ui/button"

function mergeById(prev: TraceEvent[], incoming: TraceEvent[]): TraceEvent[] {
  const seen = new Set(prev.map((e) => e.id))
  const fresh = incoming.filter((e) => !seen.has(e.id))
  if (!fresh.length) return prev
  return [...prev, ...fresh].sort((a, b) => a.seq - b.seq)
}

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

  const scrollRef = useRef<HTMLDivElement>(null)
  const replayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const live = status === "running"

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

  const onRunUpdateRef = useRef(onRunUpdate)
  useEffect(() => {
    onRunUpdateRef.current = onRunUpdate
  }, [onRunUpdate])

  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const mergeEvents = useCallback((incoming: TraceEvent[]) => {
    setEvents((prev) => mergeById(prev, incoming))
  }, [])

  // ---- polling fallback: the parent refetches the run every 5 s while it is
  // running (and on invalidation). Where /ws is unavailable that refetch is
  // the only source of new events and of the final status, so fold the new
  // props in (React's "adjust state when a prop changes" pattern). Merging
  // only appends (deduped by id), so replay's index/visible slice is kept.
  // The parent reacts to the status change itself (it owns that query).
  const [syncedEvents, setSyncedEvents] = useState(initialEvents)
  if (syncedEvents !== initialEvents) {
    setSyncedEvents(initialEvents)
    setEvents((prev) => mergeById(prev, initialEvents))
  }
  const [syncedStatus, setSyncedStatus] = useState(initialStatus)
  if (syncedStatus !== initialStatus) {
    setSyncedStatus(initialStatus)
    setStatus(initialStatus)
  }

  type RunSnapshot = { run: { events: TraceEvent[]; status?: string; endedAt?: string | null } }

  // ---- live: subscribe for new events (and close the REST→WS gap) ----
  useEffect(() => {
    if (!live) return
    let active = true
    const unsubscribe = subscribeRun(runId, {
      onConnectionChange: (c) => {
        if (active) setConnected(c)
      },
      // Events/status changes between the page's REST load (or a reconnect)
      // and the subscription are not streamed, so re-read the run.
      onSubscribed: () => {
        api<RunSnapshot>(`/api/runs/${runId}`)
          .then((data) => {
            if (!active) return
            mergeEvents(data.run.events)
            const st = data.run.status
            if (st && st !== "running") {
              setStatus(st as typeof status)
              onRunUpdateRef.current?.({ status: st, endedAt: data.run.endedAt ?? null })
            }
          })
          .catch(() => {})
      },
      onEvent: (event) => {
        if (active) mergeEvents([event])
      },
      onRunUpdate: (patch) => {
        if (!active || !patch.status) return
        setStatus(patch.status as typeof status)
        onRunUpdateRef.current?.(patch)
        if (patch.status !== "running") {
          // Final fill: a last event may have committed after the run status.
          // Runs independent of this effect's lifetime (live flips to false).
          api<RunSnapshot>(`/api/runs/${runId}`)
            .then((data) => {
              if (mountedRef.current) mergeEvents(data.run.events)
            })
            .catch(() => {})
        }
      },
      onError: () => {
        if (active) setConnected(false)
      },
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [runId, live, mergeEvents])

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

      {/* canvas + detail panel */}
      <div className="flex flex-1 min-h-0">
        <div ref={scrollRef} className="flex-1 min-w-0 relative">
          {events.length === 0 ? (
            <ListeningState runId={runId} live={live} />
          ) : isDesktop ? (
            <LifelineDiagram
              events={visibleEvents}
              participants={participants}
              selectedId={selectedId}
              onSelect={setSelectedId}
              live={live && !isReplay}
            />
          ) : (
            <StackedTimeline
              events={visibleEvents}
              participants={participants}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          )}
        </div>

        {/* desktop side panel */}
        <EventDetailPanel
          event={selectedEvent}
          participants={participants}
          onClose={() => setSelectedId(null)}
          variant="panel"
        />
      </div>

      {/* mobile sheet detail */}
      <EventDetailPanel
        event={selectedEvent}
        participants={participants}
        onClose={() => setSelectedId(null)}
        variant="sheet"
      />
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
