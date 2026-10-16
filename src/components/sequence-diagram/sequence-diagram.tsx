"use client"

import { useEffect, useMemo, useRef, useState, useCallback } from "react"
import { subscribeRun } from "@/lib/live"
import { api } from "@/lib/api"
import { filterEvents } from "@/lib/run-filters"
import { EVENT_COLORS, type EventType, type TraceEvent } from "@/lib/types"
import { extractParticipants } from "@/lib/participant-kinds"
import { ThemedDiagram } from "./themed-diagram"
import { StackedTimeline } from "./stacked-timeline"
import { EventDetailPanel } from "./event-detail-panel"
import { FilterBar, type LiveState } from "./filter-bar"
import { TransportBar, type ReplaySpeed } from "./transport-bar"
import { scrubberPositions } from "./scrubber"
import { useMediaQuery } from "@/lib/hooks"

// Hidden event types last for the browser session (across runs), not longer.
const HIDDEN_TYPES_KEY = "lanetrace-hidden-types"
// Before the AgentTrace -> LaneTrace rename (a tab open across the upgrade).
const LEGACY_HIDDEN_TYPES_KEY = "agenttrace-hidden-types"

function readHiddenTypes(): Set<EventType> {
  try {
    const raw = sessionStorage.getItem(HIDDEN_TYPES_KEY) ?? sessionStorage.getItem(LEGACY_HIDDEN_TYPES_KEY)
    const stored: unknown = JSON.parse(raw ?? "[]")
    return new Set(Array.isArray(stored) ? stored.filter((t): t is EventType => t in EVENT_COLORS) : [])
  } catch {
    return new Set()
  }
}

function writeHiddenTypes(types: ReadonlySet<EventType>) {
  try {
    sessionStorage.setItem(HIDDEN_TYPES_KEY, JSON.stringify([...types]))
  } catch {}
}

export interface RunStats {
  /** Events in the merged list (REST load, live stream and refetches). */
  count: number
  /** Timestamp of the latest of them. */
  lastTimestamp: string | null
}

function mergeById(prev: TraceEvent[], incoming: TraceEvent[]): TraceEvent[] {
  const seen = new Set(prev.map((e) => e.id))
  const fresh = incoming.filter((e) => !seen.has(e.id))
  if (!fresh.length) return prev
  return [...prev, ...fresh].sort((a, b) => a.seq - b.seq)
}

interface Props {
  runId: string
  runName: string
  projectName: string
  startedAt: string
  endedAt: string | null
  initialEvents: TraceEvent[]
  initialStatus: "running" | "completed" | "failed"
  onRunUpdate?: (patch: any) => void
  /** The merged event list's size and latest timestamp, whenever they change (the run header). */
  onStats?: (stats: RunStats) => void
}

export function SequenceDiagram({
  runId,
  runName,
  projectName,
  startedAt,
  endedAt,
  initialEvents,
  initialStatus,
  onRunUpdate,
  onStats,
}: Props) {
  const [events, setEvents] = useState<TraceEvent[]>(initialEvents)
  const [status, setStatus] = useState(initialStatus)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [isReplay, setIsReplay] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [replayIdx, setReplayIdx] = useState(initialEvents.length - 1)
  const [replaySpeed, setReplaySpeed] = useState<ReplaySpeed>(1)
  // Bumped by each seek: the canvas scrolls the playhead's row into view.
  const [seekCount, setSeekCount] = useState(0)
  const [connected, setConnected] = useState(false)
  const [everConnected, setEverConnected] = useState(false)
  const [hidden, setHidden] = useState<Set<EventType>>(readHiddenTypes)
  const [query, setQuery] = useState("")
  // A live run opened before its first event: those events arrive (theme
  // animation) rather than play the opening cascade.
  const [openedEmpty] = useState(initialEvents.length === 0)
  const isDesktop = useMediaQuery("(min-width: 768px)")
  // From xl the inspector is the side panel; below it, a sheet.
  const isWide = useMediaQuery("(min-width: 1280px)")

  const replayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const live = status === "running"

  // ---- visible events (respect replay mode) ----
  const visibleEvents = useMemo(() => {
    if (!isReplay) return events
    return events.slice(0, replayIdx + 1)
  }, [events, isReplay, replayIdx])

  // ---- filters: hidden types leave the diagram; a search marks matches ----
  const { visible: shownEvents, matches } = useMemo(
    () => filterEvents(visibleEvents, hidden, query),
    [visibleEvents, hidden, query]
  )
  const searching = query.trim() !== ""
  // The stacked timeline is a list: there a search narrows it instead of dimming.
  const listEvents = useMemo(
    () => (searching ? shownEvents.filter((e) => matches.has(e.id)) : shownEvents),
    [searching, shownEvents, matches]
  )

  const toggleType = useCallback(
    (type: EventType) => {
      const next = new Set(hidden)
      if (!next.delete(type)) next.add(type)
      setHidden(next)
      writeHiddenTypes(next)
    },
    [hidden]
  )

  const participants = useMemo(() => extractParticipants(events), [events])

  const selectedIndex = useMemo(() => events.findIndex((e) => e.id === selectedId), [events, selectedId])
  const selectedEvent = selectedIndex >= 0 ? events[selectedIndex] : null
  const positions = useMemo(() => scrubberPositions(events), [events])

  const onRunUpdateRef = useRef(onRunUpdate)
  const onStatsRef = useRef(onStats)
  useEffect(() => {
    onRunUpdateRef.current = onRunUpdate
    onStatsRef.current = onStats
  }, [onRunUpdate, onStats])

  // The header counts the merged list, so it never lags behind the diagram.
  const lastTimestamp = events.at(-1)?.timestamp ?? null
  useEffect(() => {
    onStatsRef.current?.({ count: events.length, lastTimestamp })
  }, [events.length, lastTimestamp])

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
        if (!active) return
        setConnected(c)
        if (c) setEverConnected(true)
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

  const exitReplay = useCallback(() => {
    setIsReplay(false)
    setIsPlaying(false)
  }, [])

  // Play enters replay (from the start when the playhead is at the end).
  const togglePlay = useCallback(() => {
    // Instant outside replay: everything is already shown, nothing to play.
    if (replaySpeed === 0 && !isReplay) return
    setIsReplay(true)
    // instant speed → jump straight to the end
    if (replaySpeed === 0) {
      setReplayIdx(events.length - 1)
      setIsPlaying(false)
      return
    }
    const atEnd = !isReplay || replayIdx >= events.length - 1
    if (atEnd) {
      setReplayIdx(0)
      setIsPlaying(true)
    } else setIsPlaying((p) => !p)
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

  // Seeking (dragging the playhead, its keys) enters replay and pauses.
  const seek = useCallback(
    (idx: number) => {
      setIsReplay(true)
      setSeekCount((n) => n + 1)
      setReplayIdx(Math.max(0, Math.min(idx, events.length - 1)))
      setIsPlaying(false)
    },
    [events.length]
  )

  const clearSelection = useCallback(() => setSelectedId(null), [])
  const rootRef = useRef<HTMLDivElement>(null)
  const focusCanvas = useCallback(
    () => rootRef.current?.querySelector<HTMLElement>('[data-testid="diagram"]')?.focus({ preventScroll: true }),
    []
  )
  const liveState: LiveState | null = !live ? null : connected ? "listening" : everConnected ? "reconnecting" : "connecting"

  return (
    <div ref={rootRef} className="flex flex-col h-full min-h-0">
      <FilterBar
        hidden={hidden}
        onToggle={toggleType}
        query={query}
        onQuery={setQuery}
        matchCount={searching ? matches.size : null}
        live={liveState}
      />

      {/* canvas + inspector (the md–xl overlay inspector sits over the canvas's right edge) */}
      <div className="relative flex flex-1 min-h-0">
        <div className="flex-1 min-w-0 relative">
          {events.length === 0 ? (
            <ListeningState runId={runId} live={live} />
          ) : isDesktop ? (
            <ThemedDiagram
              events={shownEvents}
              participants={participants}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onKeySelect={setSelectedId}
              matches={searching ? matches : null}
              live={live && !isReplay}
              follow={live || isReplay}
              revealKey={seekCount}
              run={{
                name: runName,
                project: projectName,
                status,
                startedAt,
                endedAt,
                eventCount: events.length,
                lastEventAt: lastTimestamp,
              }}
              speed={isReplay ? replaySpeed : 1}
              openingCascade={!openedEmpty}
              keepSeen={!isReplay}
              unfilteredEvents={visibleEvents}
            />
          ) : (
            <StackedTimeline
              events={listEvents}
              participants={participants}
              selectedId={selectedId}
              onSelect={setSelectedId}
              follow={live || isReplay}
              revealKey={seekCount}
            />
          )}
        </div>

        {/* From xl a docked panel; md–xl a non-modal overlay below the run header and
            filter row, so the keyboard keeps moving the selection; phones a modal sheet. */}
        <EventDetailPanel
          event={selectedEvent}
          index={selectedIndex}
          total={events.length}
          participants={participants}
          onClose={clearSelection}
          returnFocus={focusCanvas}
          variant={isWide ? "panel" : isDesktop ? "overlay" : "sheet"}
        />
      </div>

      {events.length >= 2 && (
        <TransportBar
          events={events}
          positions={positions}
          currentIndex={isReplay ? replayIdx : events.length - 1}
          isReplay={isReplay}
          isPlaying={isPlaying}
          speed={replaySpeed}
          live={live}
          onTogglePlay={togglePlay}
          onSeek={seek}
          onSpeed={handleSpeed}
          onBackToLive={exitReplay}
        />
      )}
    </div>
  )
}

function ListeningState({ runId, live }: { runId: string; live: boolean }) {
  return (
    <div className="h-full at-canvas relative flex flex-col items-center justify-center p-6 text-center overflow-hidden">
      {/* A live run waits: the dot breathes. A finished run is simply empty. */}
      <span aria-hidden className="relative flex h-3 w-3">
        {live && <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--st-running)] opacity-60 at-pulse-ring" />}
        <span
          className={
            "relative inline-flex h-3 w-3 rounded-full " +
            (live ? "bg-[var(--st-running)]" : "border border-[var(--line-strong)]")
          }
        />
      </span>
      <h2 className="mt-5 text-base font-semibold text-[var(--ink)]">
        {live ? "Waiting for the first event" : "This run has no events"}
      </h2>
      <p className="mt-1.5 max-w-sm text-sm text-[var(--ink-2)]">
        {live
          ? "Events appear here the moment your agent sends them."
          : "Start a new run or send events with the SDK."}
      </p>
      <div className="mt-4 rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--surface-1)] px-3 py-2 font-mono text-[11px] text-[var(--ink-2)]">
        POST /api/events · run {runId.slice(0, 8)}…
      </div>
    </div>
  )
}
