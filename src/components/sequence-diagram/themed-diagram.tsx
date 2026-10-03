"use client"

import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { motion } from "framer-motion"
import { DIAGRAM_STYLES, type DiagramStyle } from "@/lib/diagram-styles"
import { useMediaQuery } from "@/lib/hooks"
import { useTheme } from "@/lib/theme"
import type { Participant, TraceEvent } from "@/lib/types"
import { computeActivations } from "./activation"
import { advanceTrack, CASCADE_DRAW_MS, FADE_MS, isFresh, QUICK_MS, SPRING_REACH, type ArrivalPlan, type ArrivalTrack } from "./arrivals"
import { Arrow } from "./arrow"
import { TitleBlock, Vignette, type RunMeta } from "./decorations"
import { clockTime } from "./format"
import { computeGeometry, LAYOUT, type Layout } from "./geometry"
import { headerBox, LaneHeaders } from "./lane-headers"
import { rowsInView, visibleRange } from "./virtual-window"

export interface ThemedDiagramProps {
  events: TraceEvent[]
  participants: Participant[]
  selectedId: string | null
  onSelect: (id: string) => void
  live: boolean
  /** Defaults to the active theme's style; pass one to force a theme (demo loop, previews). */
  style?: DiagramStyle
  /** Run details for the Cyanotype title block (no title block without it). */
  run?: RunMeta
  /** Lane and row metrics; compact previews pass a smaller layout. */
  layout?: Layout
  /** Replay speed: arrivals play this much faster; 0 (instant) draws new events without animation. */
  speed?: number
  /** Draw the events present when the diagram opens with the short opening cascade (default).
   * False when it opens on a live run's first events, so they arrive with the theme's animation. */
  openingCascade?: boolean
}

interface Viewport {
  top: number
  height: number
}

const BAR_W = 6

function sameIds(ids: string[], events: TraceEvent[]) {
  return ids.length === events.length && events.every((e, i) => e.id === ids[i])
}

/** The sequence diagram, drawn in the style of the active theme. */
export function ThemedDiagram({
  events,
  participants,
  selectedId,
  onSelect,
  live,
  style: forcedStyle,
  run,
  layout = LAYOUT,
  speed = 1,
  openingCascade = true,
}: ThemedDiagramProps) {
  const resolved = useTheme((s) => s.resolved)
  const style = forcedStyle ?? DIAGRAM_STYLES[resolved]
  // Follows the OS setting live (framer's useReducedMotion reads it once per mount).
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)")
  const geometry = useMemo(() => computeGeometry(events, participants, layout), [events, participants, layout])
  const { width, height, lanes, arrows } = geometry
  const bars = useMemo(() => computeActivations(events), [events])
  const laneX = useMemo(() => new Map(lanes.map((l) => [l.name, l.x])), [lanes])
  const top = layout.headerHeight
  const lifelineEnd = height - layout.bottomPad
  // The lifelines continue the stubs drawn in the header: keep the dash pattern in phase.
  const dashPhase = top - headerBox(layout).bottom

  // The viewport of the scroll container, kept at row precision: the diagram
  // re-renders when the rows in view change, not on every scroll event.
  const scrollRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<Viewport | null>(null)
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const firstRow = (px: number) => Math.floor(Math.max(0, px - layout.headerHeight) / layout.rowHeight)
    const rowCount = (px: number) => Math.ceil(px / layout.rowHeight)
    const read = () => {
      const next = { top: el.scrollTop, height: el.clientHeight }
      setView((v) => (v && firstRow(v.top) === firstRow(next.top) && rowCount(v.height) === rowCount(next.height) ? v : next))
    }
    read()
    el.addEventListener("scroll", read, { passive: true })
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(read)
    observer?.observe(el)
    return () => {
      el.removeEventListener("scroll", read)
      observer?.disconnect()
    }
  }, [layout.headerHeight, layout.rowHeight])

  // Which events animate, and how: worked out when the event list changes
  // (React's "adjust state while rendering" pattern), once the viewport is
  // known, so the opening cascade plays on the rows the user actually sees.
  const [track, setTrack] = useState<ArrivalTrack | null>(null)
  let arrivals = track
  if (view && (track === null || !sameIds(track.ids, events))) {
    arrivals = advanceTrack(track, events, {
      style,
      reducedMotion,
      speed,
      now: performance.now(),
      openingCascade,
      inView: rowsInView(events.length, view.top, view.height, layout.rowHeight, layout.headerHeight),
    })
    setTrack(arrivals)
  }

  // Nothing is drawn before the viewport is measured (a layout effect, so before the first paint).
  const range = view
    ? visibleRange(arrows.length, view.top, view.height, layout.rowHeight, layout.headerHeight)
    : { start: 0, end: 0 }
  const shown = arrows.slice(range.start, range.end)

  return (
    <div className="relative h-full">
      <div
        ref={scrollRef}
        data-testid="diagram"
        data-theme-style={style.theme}
        className="at-canvas at-scroll relative h-full overflow-auto"
        // The canvas grid stays put while the content scrolls; the lane-header
        // band scrolls sideways with it, so it shifts its own grid back by this.
        onScroll={(e) => e.currentTarget.style.setProperty("--scroll-x", `${e.currentTarget.scrollLeft}px`)}
      >
        {/* At least as wide and tall as the viewport, so the header band spans it
            and the title block can sit at its bottom-right corner. */}
        <div className="relative flex min-h-full flex-col" style={{ width, minWidth: "100%" }}>
          <LaneHeaders lanes={lanes} width={width} layout={layout} style={style} flashes={arrivals?.flashes} />
          {/* Full height even when only a window of rows is drawn, so scrolling stays native. */}
          <svg width={width} height={height - top} className="mx-auto block shrink-0 select-none">
            {/* Body coordinates match ArrowGeom.y (measured from the top of the header). */}
            <g transform={`translate(0 ${-top})`}>
              <g aria-hidden>
                {lanes.map((lane) => (
                  <line
                    key={lane.name}
                    x1={lane.x}
                    x2={lane.x}
                    y1={top}
                    y2={lifelineEnd}
                    stroke="var(--line-strong)"
                    strokeDasharray={style.lifeline.dash || undefined}
                    strokeDashoffset={style.lifeline.dash ? dashPhase : undefined}
                    strokeWidth={style.lifeline.width}
                    shapeRendering="crispEdges"
                  />
                ))}
                {/* Activation bars: a tool at work, from its call to its result (or the live cursor). */}
                {bars.map((bar) => {
                  const x = laneX.get(bar.lane)
                  const last = bar.toIndex ?? arrows.length
                  if (x === undefined || bar.fromIndex >= range.end || last < range.start) return null
                  const y0 = arrows[bar.fromIndex].y
                  const y1 = bar.toIndex === null ? lifelineEnd : arrows[bar.toIndex].y
                  return (
                    // Keyed by the opening call, not its row: filters shift row indexes.
                    <AppearWith key={arrows[bar.fromIndex].id} plan={arrivals?.plans.get(arrows[bar.fromIndex].id)} at="reach" style={style}>
                      <rect
                        data-activation={bar.lane}
                        x={x - BAR_W / 2}
                        y={y0}
                        width={BAR_W}
                        height={y1 - y0}
                        fill="var(--ev-tool)"
                        fillOpacity={0.18}
                        stroke="var(--ev-tool)"
                        strokeOpacity={0.5}
                        strokeWidth={1}
                      />
                    </AppearWith>
                  )
                })}
                {shown.map((a) => (
                  <AppearWith key={a.id} plan={arrivals?.plans.get(a.id)} at="start" style={style}>
                    <text
                      x={layout.leftGutter - 10}
                      y={a.y + 3}
                      textAnchor="end"
                      fontFamily="var(--font-data)"
                      fontSize={9}
                      fill="var(--ink-3)"
                    >
                      {clockTime(events[a.index].timestamp)}
                    </text>
                  </AppearWith>
                ))}
              </g>
              {shown.map((a) => (
                <Arrow
                  key={a.id}
                  a={a}
                  source={events[a.index].source}
                  target={events[a.index].target}
                  style={style}
                  selected={a.id === selectedId}
                  onSelect={onSelect}
                  arrival={arrivals?.plans.get(a.id)}
                />
              ))}
              {live && (
                <g>
                  <line
                    x1={layout.leftGutter}
                    x2={width - layout.rightPad}
                    y1={lifelineEnd}
                    y2={lifelineEnd}
                    stroke="var(--st-running)"
                    strokeOpacity={0.5}
                    strokeWidth={1}
                    shapeRendering="crispEdges"
                  />
                  <text x={layout.leftGutter} y={lifelineEnd + 16} fontFamily="var(--font-ui)" fontSize={10} fill="var(--ink-2)">
                    Waiting for the next event
                  </text>
                </g>
              )}
            </g>
          </svg>
          {run && style.decorations.includes("titleBlock") && (
            <TitleBlock run={run} eventCount={events.length} lastEventAt={events.at(-1)?.timestamp ?? null} />
          )}
        </div>
      </div>
      {style.decorations.includes("vignette") && <Vignette />}
    </div>
  )
}

/** Fades `children` in with an arriving event: from the start of its arrival
 * (the gutter clock) or when its line reaches the target (an activation bar,
 * the tool starting work). Plays once, from mount, like the arrow. */
function AppearWith({ plan, at, style, children }: { plan?: ArrivalPlan; at: "start" | "reach"; style: DiagramStyle; children: ReactNode }) {
  const [appear] = useState(() => (plan && isFresh(plan, performance.now()) ? plan : null))
  if (!appear) return <>{children}</>
  const { drawMs } = style.timing
  const reach = { pulse: drawMs, pen: drawMs, spring: SPRING_REACH * drawMs, cascade: 0, fade: 0 }[appear.kind] / appear.speed
  const over = appear.kind === "fade" ? FADE_MS : appear.kind === "cascade" ? CASCADE_DRAW_MS : at === "start" ? drawMs / appear.speed : QUICK_MS
  return (
    <motion.g
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: (appear.delayMs + (at === "reach" ? reach : 0)) / 1000, duration: over / 1000 }}
    >
      {children}
    </motion.g>
  )
}
