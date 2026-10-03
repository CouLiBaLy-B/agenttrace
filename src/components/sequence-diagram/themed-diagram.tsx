"use client"

import { useMemo } from "react"
import { DIAGRAM_STYLES, type DiagramStyle } from "@/lib/diagram-styles"
import { useTheme } from "@/lib/theme"
import type { Participant, TraceEvent } from "@/lib/types"
import { Arrow } from "./arrow"
import { TitleBlock, Vignette, type RunMeta } from "./decorations"
import { clockTime } from "./format"
import { computeGeometry, LAYOUT, type Layout } from "./geometry"
import { headerBox, LaneHeaders } from "./lane-headers"

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
}: ThemedDiagramProps) {
  const resolved = useTheme((s) => s.resolved)
  const style = forcedStyle ?? DIAGRAM_STYLES[resolved]
  const geometry = useMemo(() => computeGeometry(events, participants, layout), [events, participants, layout])
  const { width, height, lanes, arrows } = geometry
  const top = layout.headerHeight
  const lifelineEnd = height - layout.bottomPad
  // The lifelines continue the stubs drawn in the header: keep the dash pattern in phase.
  const dashPhase = top - headerBox(layout).bottom

  return (
    <div className="relative h-full">
      <div
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
          <LaneHeaders lanes={lanes} width={width} layout={layout} style={style} />
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
                {arrows.map((a, i) => (
                  <text
                    key={a.id}
                    x={layout.leftGutter - 10}
                    y={a.y + 3}
                    textAnchor="end"
                    fontFamily="var(--font-data)"
                    fontSize={9}
                    fill="var(--ink-3)"
                  >
                    {clockTime(events[i].timestamp)}
                  </text>
                ))}
              </g>
              {arrows.map((a) => (
                <Arrow
                  key={a.id}
                  a={a}
                  source={events[a.index].source}
                  target={events[a.index].target}
                  style={style}
                  selected={a.id === selectedId}
                  onSelect={onSelect}
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
