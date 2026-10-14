"use client"

import { memo, useEffect, useId, useMemo, useState, type ReactNode } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { easeOut, motion } from "framer-motion"
import { api } from "@/lib/api"
import { DIAGRAM_STYLES, type DiagramStyle } from "@/lib/diagram-styles"
import { useMediaQuery } from "@/lib/hooks"
import { subscribeRun } from "@/lib/live"
import { useTheme } from "@/lib/theme"
import type { ThemeId } from "@/lib/theme-core"
import { eventPaint, type RunShape, type TraceEvent } from "@/lib/types"
import { miniGeometry, type MiniArrow } from "./mini-geometry"

/** A mini diagram draws at most the first (or, live, the last) 12 events. */
export const MINI_EVENTS = 12
const PAD = 6
const HEAD = 3 // head length (px)
const HEAD_HALF = 2.2
const LOOP_W = 10 // control reach of a self-message, right of its lifeline (the curve peaks at 3/4 of it)
const CROSS = 1.8
const FADE_MS = 120
const SLIDE_MS = 200 // live rows moving up one place when an event arrives
const SPRING = { type: "spring" as const, stiffness: 380, damping: 26 }

type Arrival = "pulse" | "pen" | "spring" | "fade"

/** The line, head and error cross of one mini arrow, drawn on its own row (y = 0). */
function geometryOf(a: MiniArrow, rowH: number, style: DiagramStyle) {
  const open = style.arrow.head === "open"
  if (a.selfLoop) {
    const h = Math.min(3.5, rowH * 0.4)
    const x = a.x1
    const tip = { x, y: h }
    const end = open ? x : x + HEAD - 0.5
    return {
      d: `M ${x} ${-h} C ${x + LOOP_W} ${-h}, ${x + LOOP_W} ${h}, ${end} ${h}`,
      tip,
      dir: -1 as const,
      // beside the loop, not on it: the curve is too small to carry a cross
      cross: { x: x + LOOP_W * 0.75 + 4, y: 0 },
      origin: 0 as const,
    }
  }
  const dir: 1 | -1 = a.x2 >= a.x1 ? 1 : -1
  const end = open ? a.x2 : a.x2 - dir * (HEAD - 0.5)
  return {
    d: `M ${a.x1} 0 L ${end} 0`,
    tip: { x: a.x2, y: 0 },
    dir,
    cross: { x: (a.x1 + a.x2) / 2, y: 0 },
    // scaleX grows the line out of its source end
    origin: (dir === 1 ? 0 : 1) as 0 | 1,
  }
}

function halfDash(dash: string) {
  return dash
    .split(/\s+/)
    .filter(Boolean)
    .map((n) => Number(n) / 2)
    .join(" ")
}

function Lifelines({ lanes, height, style }: { lanes: number[]; height: number; style: DiagramStyle }) {
  return (
    <g stroke="var(--line-strong)" strokeWidth={style.lifeline.width} strokeDasharray={style.lifeline.dash || undefined}>
      {lanes.map((x, i) => (
        <line key={i} x1={x} y1={PAD / 2} x2={x} y2={height - PAD / 2} />
      ))}
    </g>
  )
}

/** One arrow at y = 0; `arrival` animates it in once, from mount. */
const MiniArrowMark = memo(function MiniArrowMark({
  a,
  rowH,
  style,
  arrival,
}: {
  a: MiniArrow
  rowH: number
  style: DiagramStyle
  arrival?: Arrival
}) {
  const { color } = eventPaint(a.type, a.isError)
  const g = geometryOf(a, rowH, style)
  const open = style.arrow.head === "open"
  const maskId = `at-mini-${useId().replace(/[^\w-]/g, "")}`
  // Read once: the plan belongs to the theme the arrow mounted in. A theme
  // switch mid-arrival shows the arrow as it is in the new theme.
  const [plan] = useState(arrival)
  const [planTheme] = useState<ThemeId>(style.theme)
  const kind = plan && planTheme === style.theme ? plan : undefined
  const draw = style.timing.drawMs / 1000
  const settle = style.timing.settleMs / 1000

  const base = g.tip.x - g.dir * HEAD
  const head = open ? (
    <polyline
      points={`${base},${g.tip.y - HEAD_HALF} ${g.tip.x},${g.tip.y} ${base},${g.tip.y + HEAD_HALF}`}
      fill="none"
      stroke={color}
      strokeWidth={1}
    />
  ) : (
    <polygon points={`${g.tip.x},${g.tip.y} ${base},${g.tip.y - HEAD_HALF} ${base},${g.tip.y + HEAD_HALF}`} fill={color} />
  )
  const cross = a.isError && (
    <g stroke="var(--ev-error)" strokeWidth={1.2} strokeLinecap="round">
      <line x1={g.cross.x - CROSS} y1={g.cross.y - CROSS} x2={g.cross.x + CROSS} y2={g.cross.y + CROSS} />
      <line x1={g.cross.x - CROSS} y1={g.cross.y + CROSS} x2={g.cross.x + CROSS} y2={g.cross.y - CROSS} />
    </g>
  )
  const drawn = kind === "pulse" || kind === "pen"
  const line = (
    <path
      d={g.d}
      fill="none"
      stroke={color}
      strokeWidth={1}
      strokeDasharray={a.isReturn ? halfDash(style.arrow.returnDash) : undefined}
      mask={drawn ? `url(#${maskId})` : undefined}
    />
  )

  if (!kind) {
    return (
      <>
        {line}
        {head}
        {cross}
      </>
    )
  }
  if (kind === "fade") {
    return (
      <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: FADE_MS / 1000 }}>
        {line}
        {head}
        {cross}
      </motion.g>
    )
  }
  if (kind === "spring") {
    return (
      <motion.g initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={SPRING} style={{ originX: g.origin }}>
        {line}
        {head}
        {cross}
      </motion.g>
    )
  }
  // pulse / pen: the line is drawn through a mask (pathLength would rewrite a
  // return's dashes); the head and cross land when it arrives.
  const landed = { delay: draw, duration: kind === "pen" ? settle : FADE_MS / 1000 }
  return (
    <>
      <mask id={maskId} maskUnits="userSpaceOnUse" x={-PAD} y={-rowH - 4} width={10_000} height={2 * rowH + 8}>
        <motion.path
          d={g.d}
          fill="none"
          stroke="white"
          strokeWidth={6}
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: draw, ease: kind === "pen" ? "linear" : easeOut }}
        />
      </mask>
      {kind === "pulse" && (
        // The glow: a soft wider copy of the line that fades as it settles.
        <motion.path
          d={g.d}
          fill="none"
          stroke={color}
          strokeWidth={3}
          mask={`url(#${maskId})`}
          style={{ filter: "blur(1.5px)" }}
          initial={{ opacity: 0.8 }}
          animate={{ opacity: 0 }}
          transition={{ delay: draw, duration: settle }}
        />
      )}
      {line}
      <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={landed}>
        {head}
        {cross}
      </motion.g>
    </>
  )
})

/** A run's first events as a small sequence diagram. Decorative: the tile around it carries the text. */
export function MiniDiagram({ shape, width, height }: { shape: RunShape; width: number; height: number }) {
  const resolved = useTheme((s) => s.resolved)
  const style = DIAGRAM_STYLES[resolved]
  const clipped = useMemo(() => ({ ...shape, events: shape.events.slice(0, MINI_EVENTS) }), [shape])
  const geo = useMemo(() => miniGeometry(clipped, width, height, PAD), [clipped, width, height])
  const rowH = (height - 2 * PAD) / Math.max(1, clipped.events.length)
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false" className="block">
      <Lifelines lanes={geo.lanes} height={height} style={style} />
      {geo.arrows.map((a, i) => (
        <g key={i} transform={`translate(0 ${a.y})`}>
          <MiniArrowMark a={{ ...a, y: 0 }} rowH={rowH} style={style} />
        </g>
      ))}
    </svg>
  )
}

interface RunSnapshot {
  run: { events: TraceEvent[]; status?: string }
}

function mergeById(prev: TraceEvent[], more: TraceEvent[]): TraceEvent[] {
  const ids = new Set(prev.map((e) => e.id))
  const fresh = more.filter((e) => !ids.has(e.id))
  if (fresh.length === 0) return prev
  return [...prev, ...fresh].sort((x, y) => x.seq - y.seq)
}

/** The run's events (the run view's `["run", id]` query), kept current over
 * /ws while `live`: streamed events are merged into that cache, so every
 * reader of the query sees them. Polls every 5 s while the socket is down. */
export function useLiveRunEvents(runId: string, live = true): TraceEvent[] | undefined {
  const qc = useQueryClient()
  const [connected, setConnected] = useState(false)
  const { data } = useQuery<RunSnapshot>({
    queryKey: ["run", runId],
    queryFn: () => api(`/api/runs/${runId}`),
    refetchInterval: live && !connected ? 5000 : false,
  })
  useEffect(() => {
    if (!live) return
    const key = ["run", runId]
    let active = true
    // Events streamed before the run is in the cache (the first load or the
    // snapshot still in flight) wait here and are merged when it lands.
    let pending: TraceEvent[] = []
    const merge = (old: RunSnapshot, more: TraceEvent[]): RunSnapshot => ({
      ...old,
      run: { ...old.run, events: mergeById(old.run.events ?? [], more) },
    })
    const unsubscribe = subscribeRun(runId, {
      onConnectionChange: setConnected,
      // Events between the REST load and the subscription are not streamed:
      // fetch the run once and merge it by id, so an event streamed while the
      // snapshot was in flight is kept. The first load is cancelled first, so
      // it can't land later and overwrite the merged cache.
      onSubscribed: async () => {
        try {
          const snap = await api<RunSnapshot>(`/api/runs/${runId}`)
          if (!active) return
          await qc.cancelQueries({ queryKey: key })
          if (!active) return
          const buffered = pending
          pending = []
          qc.setQueryData<RunSnapshot>(key, (old) => {
            const base = old ? { ...old, run: { ...old.run, ...snap.run, events: old.run.events ?? [] } } : snap
            return merge(base, [...(snap.run.events ?? []), ...buffered])
          })
        } catch {
          // The snapshot failed (or the first load was cancelled): load again.
          if (active) qc.invalidateQueries({ queryKey: key })
        }
      },
      onEvent: (event) => {
        if (!qc.getQueryData<RunSnapshot>(key)) {
          pending.push(event)
          return
        }
        const buffered = pending
        pending = []
        qc.setQueryData<RunSnapshot>(key, (old) => (old ? merge(old, [...buffered, event]) : old))
      },
      onError: () => setConnected(false),
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [runId, live, qc])
  return data?.run.events
}

/** The last 12 events of a running run, each new one arriving with the
 * theme's motion (a fade with reduced motion). */
export function LiveMiniDiagram({ runId, width, height }: { runId: string; width: number; height: number }) {
  const resolved = useTheme((s) => s.resolved)
  const style = DIAGRAM_STYLES[resolved]
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)")
  const events = useLiveRunEvents(runId)

  // The events already there on the first load are drawn still; only later ones arrive.
  const [baseline, setBaseline] = useState<Set<string> | null>(null)
  if (baseline === null && events) setBaseline(new Set(events.map((e) => e.id)))

  const { lanes, rows } = useMemo(() => {
    const all = events ?? []
    // Lanes from every event seen, in first-seen order, so they never shift.
    const participants: string[] = []
    for (const e of all) for (const p of [e.source, e.target]) if (!participants.includes(p)) participants.push(p)
    const index = new Map(participants.map((p, i) => [p, i]))
    const last = all.slice(-MINI_EVENTS)
    const shape: RunShape = {
      participants,
      events: last.map((e) => ({ s: index.get(e.source) ?? 0, t: index.get(e.target) ?? 0, type: e.type, status: e.status })),
    }
    const geo = miniGeometry(shape, width, height, PAD)
    return { lanes: geo.lanes, rows: geo.arrows.map((a, i) => ({ id: last[i].id, a })) }
  }, [events, width, height])

  // Fixed row height (12 rows, filled from the top), so rows only move when an event pushes them up.
  const rowH = (height - 2 * PAD) / MINI_EVENTS
  const arrival: Arrival = reduced ? "fade" : style.arrival

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false" className="block">
      <Lifelines lanes={lanes} height={height} style={style} />
      {rows.map(({ id, a }, i) => (
        <Row key={id} y={PAD + rowH * (i + 0.5)} slide={!reduced}>
          <MiniArrowMark
            a={{ ...a, y: 0 }}
            rowH={rowH}
            style={style}
            arrival={baseline && !baseline.has(id) ? arrival : undefined}
          />
        </Row>
      ))}
    </svg>
  )
}

/** A live row: mounts in place, then glides to its new place as events push it up. */
function Row({ y, slide, children }: { y: number; slide: boolean; children: ReactNode }) {
  return (
    <motion.g initial={false} animate={{ y }} transition={slide ? { duration: SLIDE_MS / 1000, ease: easeOut } : { duration: 0 }}>
      {children}
    </motion.g>
  )
}
