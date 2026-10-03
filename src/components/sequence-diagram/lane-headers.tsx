"use client"

import { useState } from "react"
import { motion } from "framer-motion"
import type { DiagramStyle } from "@/lib/diagram-styles"
import { isFresh, type LedFlash } from "./arrivals"
import { KIND_COLOR } from "./participants"
import { laneLabel, truncate, type DiagramGeometry, type Layout } from "./geometry"

const BOX_H = 32
// Advance of one glyph of each header's name font, measured in Chromium:
// Martian Mono 11 px (box), B612 Mono 11 px (titled), Bricolage Grotesque 600 12 px (tile).
const NAME_CHAR_PX: Record<DiagramStyle["header"], number> = { box: 8, titled: 7, tile: 6.6 }
const TILE_TEXT_X = 26 // LED + gap, from the tile's left edge
const LED_R = 2.75
const LED_OFF_MS = 200 // a lit LED fades back to rest

/** Vertical extent of the participant boxes inside the header row. */
export function headerBox(layout: Layout) {
  const top = Math.round((layout.headerHeight - BOX_H) / 2) - 2
  return { top, bottom: top + BOX_H, width: Math.min(140, layout.laneWidth - 20) }
}

interface Props {
  lanes: DiagramGeometry["lanes"]
  width: number
  layout: Layout
  style: DiagramStyle
  /** LEDs lit by arrivals, by lane name (tile headers). */
  flashes?: Readonly<Record<string, LedFlash>>
}

/** The participant row. Sticky, so the names stay in view while the events scroll under it. */
export function LaneHeaders({ lanes, width, layout, style, flashes }: Props) {
  const { top, bottom, width: boxW } = headerBox(layout)
  const inner = boxW - (style.header === "tile" ? TILE_TEXT_X + 10 : 20)
  const maxChars = Math.min(17, Math.floor(inner / NAME_CHAR_PX[style.header]))
  const mid = top + BOX_H / 2

  return (
    // .at-canvas paints the same background as the scroll container. That grid
    // does not move when the container scrolls, but this band scrolls sideways
    // with the content, so it offsets its grid by the scroll to stay seamless.
    <div className="at-canvas sticky top-0 z-10" style={{ backgroundPosition: "var(--scroll-x, 0px) 0" }}>
      <svg width={width} height={layout.headerHeight} className="mx-auto block">
        {lanes.map((lane) => {
          const x0 = lane.x - boxW / 2
          const name = truncate(laneLabel(lane.name), maxChars)
          return (
            <g key={lane.name} data-lane={lane.name}>
              <line
                x1={lane.x}
                x2={lane.x}
                y1={bottom}
                y2={layout.headerHeight}
                stroke="var(--line-strong)"
                strokeDasharray={style.lifeline.dash || undefined}
                strokeWidth={style.lifeline.width}
                shapeRendering="crispEdges"
              />
              {style.header === "box" && (
                <>
                  <rect
                    x={x0}
                    y={top}
                    width={boxW}
                    height={BOX_H}
                    rx={5}
                    fill="var(--surface-2)"
                    stroke={`color-mix(in oklab, ${KIND_COLOR[lane.kind]} 40%, transparent)`}
                    strokeWidth={1}
                  />
                  <text x={lane.x} y={mid + 4} textAnchor="middle" fontFamily="var(--font-data)" fontSize={11} fill="var(--ink)">
                    {name}
                  </text>
                </>
              )}
              {style.header === "titled" && (
                <>
                  <rect x={x0 + 0.5} y={top + 0.5} width={boxW - 1} height={BOX_H - 1} fill="var(--surface-0)" stroke="var(--ink)" strokeWidth={1} />
                  <line x1={x0 + 0.5} x2={x0 + boxW - 0.5} y1={bottom - 5} y2={bottom - 5} stroke="var(--ink)" strokeOpacity={0.6} strokeWidth={0.5} />
                  <text x={lane.x} y={top + 18} textAnchor="middle" fontFamily="var(--font-data)" fontSize={11} fill="var(--ink)">
                    {name}
                  </text>
                </>
              )}
              {style.header === "tile" && (
                <>
                  {/* --shadow-raised is a box-shadow list (drop-shadow() can't take
                      one), so the tile body is an HTML box inside the SVG. */}
                  <foreignObject x={x0 - 6} y={top - 6} width={boxW + 12} height={BOX_H + 12}>
                    <div
                      className="m-1.5 rounded-[7px]"
                      style={{ width: boxW, height: BOX_H, background: "var(--surface-2)", boxShadow: "var(--shadow-raised)" }}
                    />
                  </foreignObject>
                  <circle cx={x0 + 14} cy={mid} r={4.5} fill="var(--surface-1)" stroke="var(--line)" strokeWidth={1} />
                  <circle data-led cx={x0 + 14} cy={mid} r={LED_R} fill="var(--ink-3)" />
                  {flashes?.[lane.name] && <LitLed key={flashes[lane.name].key} flash={flashes[lane.name]} cx={x0 + 14} cy={mid} />}
                  <text x={x0 + TILE_TEXT_X} y={mid + 4} fontFamily="var(--font-ui)" fontSize={12} fontWeight={600} fill="var(--ink)">
                    {name}
                  </text>
                </>
              )}
              <title>{lane.name}</title>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/** An LED in the colour of the event that just reached its participant, with
 * a glow, for flash.durationMs; then it goes back to rest and unmounts.
 * Keyed by the event, so the next arrival relights it. */
function LitLed({ flash, cx, cy }: { flash: LedFlash; cx: number; cy: number }) {
  const [play, setPlay] = useState(() => isFresh(flash, performance.now()))
  if (!play) return null
  const total = flash.durationMs + LED_OFF_MS
  return (
    <motion.g
      initial={{ opacity: 0 }}
      // From 0: opacity runs on WAAPI, which holds the first keyframe through the delay.
      animate={{ opacity: [0, 1, 1, 0] }}
      transition={{ delay: flash.delayMs / 1000, duration: total / 1000, times: [0, 0.01, flash.durationMs / total, 1], ease: "linear" }}
      onAnimationComplete={() => setPlay(false)}
    >
      <circle data-led-lit cx={cx} cy={cy} r={LED_R} fill={flash.color} style={{ filter: `drop-shadow(0 0 3px ${flash.color})` }} />
    </motion.g>
  )
}
