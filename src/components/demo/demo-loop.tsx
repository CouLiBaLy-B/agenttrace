"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { DIAGRAM_STYLES } from "@/lib/diagram-styles"
import { useElementWidth, useMediaQuery } from "@/lib/hooks"
import { useTheme } from "@/lib/theme"
import type { ThemeId } from "@/lib/theme-core"
import { LAYOUT } from "@/components/sequence-diagram/geometry"
import { extractParticipants } from "@/lib/participant-kinds"
import { ThemedDiagram } from "@/components/sequence-diagram/themed-diagram"
import { REFUND_SCENARIO, scenarioEvents } from "./refund-scenario"

/** One loop: the five events (the last at 4.3 s), their arrival, then a 2.5 s pause. */
export const DEMO_CYCLE_MS = 7500
/** A long frame (a throttled or backgrounded tab) advances the loop by at most this. */
const MAX_FRAME_MS = 100

// Lanes 150 px wide (not 130): the header boxes then fit "Orchestrator" and
// "lookup_order" in every theme's data font without truncation. A wider left
// gutter (100, not 84) fits the widest timestamps (Martian Mono) in full.
const DEMO_LAYOUT = { ...LAYOUT, laneWidth: 150, rowHeight: 44, leftGutter: 100 }
const ALL_EVENTS = scenarioEvents(Infinity)
const PARTICIPANTS = extractParticipants(ALL_EVENTS)
const DEMO_W = DEMO_LAYOUT.leftGutter + PARTICIPANTS.length * DEMO_LAYOUT.laneWidth + DEMO_LAYOUT.rightPad
const DEMO_H = DEMO_LAYOUT.headerHeight + ALL_EVENTS.length * DEMO_LAYOUT.rowHeight + DEMO_LAYOUT.bottomPad
const noop = () => {}

/** How many of the scenario's events have arrived `ms` into a loop. */
function arrivedAt(ms: number) {
  return REFUND_SCENARIO.filter((s) => s.at <= ms).length
}

/** Whether the element is on screen and the tab visible: the loop only plays then. */
function useOnScreen(el: HTMLElement | null) {
  // Without IntersectionObserver (old browsers), treat it as always on screen.
  const [intersecting, setIntersecting] = useState(() => typeof IntersectionObserver === "undefined")
  const [tabVisible, setTabVisible] = useState(() => typeof document === "undefined" || document.visibilityState === "visible")
  useEffect(() => {
    if (!el || typeof IntersectionObserver === "undefined") return
    const io = new IntersectionObserver(([entry]) => setIntersecting(entry.isIntersecting))
    io.observe(el)
    return () => io.disconnect()
  }, [el])
  useEffect(() => {
    const read = () => setTabVisible(document.visibilityState === "visible")
    document.addEventListener("visibilitychange", read)
    return () => document.removeEventListener("visibilitychange", read)
  }, [])
  return intersecting && tabVisible
}

/** The "refund" run playing on a loop in a theme's diagram style: the sign-in
 * screen and the theme previews. Decorative (hidden from assistive tech, not
 * interactive); scales down to fit a narrower box; with reduced motion it shows
 * the whole run, still. */
export function DemoLoop({
  theme,
  preview = false,
  fitHeight,
  className,
}: {
  theme?: ThemeId
  /** A small preview: no "Waiting for the next event" caption under the live cursor. */
  preview?: boolean
  /** Also scale down to fit this height (the diagram is then centred across the box). */
  fitHeight?: number
  className?: string
}) {
  const resolved = useTheme((s) => s.resolved)
  const style = DIAGRAM_STYLES[theme ?? resolved]
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)")
  const [box, setBox] = useState<HTMLDivElement | null>(null)
  const [widthRef, width] = useElementWidth<HTMLDivElement>()
  const boxRef = useCallback(
    (el: HTMLDivElement | null) => {
      setBox(el)
      widthRef(el)
    },
    [widthRef],
  )
  const playing = useOnScreen(box) && !reducedMotion

  // The clock only re-renders when an event arrives or the loop restarts.
  const elapsed = useRef(0)
  const [frame, setFrame] = useState({ cycle: 0, count: 0 })
  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      elapsed.current += Math.min(MAX_FRAME_MS, Math.max(0, now - last))
      last = now
      const cycle = Math.floor(elapsed.current / DEMO_CYCLE_MS)
      const count = arrivedAt(elapsed.current % DEMO_CYCLE_MS)
      setFrame((f) => (f.cycle === cycle && f.count === count ? f : { cycle, count }))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  const count = reducedMotion ? ALL_EVENTS.length : frame.count
  const events = useMemo(() => ALL_EVENTS.slice(0, count), [count])
  const scale = width > 0 ? Math.min(1, width / DEMO_W, fitHeight ? fitHeight / DEMO_H : 1) : 1
  const scaled = scale < 1
  // Centred when the height, not the width, limits the scale.
  const inset = scaled ? Math.max(0, (width - DEMO_W * scale) / 2) : 0

  const diagram = (
    <div
      ref={boxRef}
      aria-hidden
      inert
      className={"overflow-hidden" + (className ? " " + className : "")}
      style={{ height: DEMO_H * scale }}
    >
      <div
        className="shrink-0"
        style={{
          width: scaled ? DEMO_W : "100%",
          height: DEMO_H,
          transform: scaled ? `translateX(${inset}px) scale(${scale})` : undefined,
          transformOrigin: "top left",
        }}
      >
        <ThemedDiagram
          // A new loop remounts the diagram, so its arrivals play again from an empty run.
          key={reducedMotion ? "still" : frame.cycle}
          events={events}
          participants={PARTICIPANTS}
          selectedId={null}
          onSelect={noop}
          live={!reducedMotion && count < ALL_EVENTS.length}
          liveCaption={!preview}
          style={style}
          layout={DEMO_LAYOUT}
          openingCascade={reducedMotion}
        />
      </div>
    </div>
  )
  if (!theme) return diagram
  // A subtree with its own theme: its tokens resolve at this root, so the font
  // and text colour are applied again here (they would inherit the page's).
  return (
    <div data-theme={theme} className="font-sans text-foreground">
      {diagram}
    </div>
  )
}
