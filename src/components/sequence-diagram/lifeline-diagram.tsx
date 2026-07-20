"use client"

import { motion } from "framer-motion"
import { TraceEvent, EVENT_COLORS } from "@/lib/types"
import { Participant } from "@/lib/types"
import { PARTICIPANT_ICON, KIND_COLOR } from "./participants"
import { extractTokens, formatTokens } from "@/lib/tokens"
import { cn } from "@/lib/utils"

const LANE_WIDTH = 150
const HEADER_HEIGHT = 76
const ROW_HEIGHT = 48
const LEFT_GUTTER = 76
const RIGHT_PAD = 24
const BOTTOM_PAD = 40

interface Props {
  events: TraceEvent[]
  participants: Participant[]
  selectedId: string | null
  onSelect: (id: string) => void
  live: boolean
}

export function LifelineDiagram({ events, participants, selectedId, onSelect, live }: Props) {
  const width = LEFT_GUTTER + participants.length * LANE_WIDTH + RIGHT_PAD
  const height = HEADER_HEIGHT + Math.max(1, events.length) * ROW_HEIGHT + BOTTOM_PAD

  const laneX = (i: number) => LEFT_GUTTER + i * LANE_WIDTH + LANE_WIDTH / 2
  const eventY = (i: number) => HEADER_HEIGHT + i * ROW_HEIGHT + ROW_HEIGHT / 2
  const indexOf = (name: string) => {
    const idx = participants.findIndex((p) => p.name === name)
    return idx === -1 ? 0 : idx
  }

  return (
    <div className="relative w-full h-full at-graticule at-scanlines overflow-auto at-scroll">
      <svg width={width} height={height} className="block" style={{ minWidth: "100%" }}>
        {/* lifelines */}
        {participants.map((p, i) => {
          const x = laneX(i)
          const Icon = PARTICIPANT_ICON[p.kind]
          const color = KIND_COLOR[p.kind]
          return (
            <g key={p.id}>
              {/* header box */}
              <rect
                x={x - 60}
                y={12}
                width={120}
                height={52}
                rx={6}
                fill="oklch(0.22 0.014 195)"
                stroke={color}
                strokeOpacity={0.4}
                strokeWidth={1}
              />
              {/* icon */}
              <g transform={`translate(${x - 54}, 28)`}>
                <foreignObject width={18} height={18}>
                  <Icon className="h-[18px] w-[18px]" style={{ color }} />
                </foreignObject>
              </g>
              {/* name */}
              <text
                x={x - 30}
                y={36}
                fill="oklch(0.9 0.015 170)"
                fontSize={11}
                fontFamily="var(--font-geist-mono)"
                className="uppercase tracking-wider"
              >
                {p.name.length > 13 ? p.name.slice(0, 12) + "…" : p.name}
              </text>
              <text
                x={x - 30}
                y={52}
                fill={color}
                fontSize={9}
                fontFamily="var(--font-geist-mono)"
                opacity={0.8}
                className="uppercase tracking-widest"
              >
                {p.kind}
              </text>
              {/* vertical lifeline (dashed) */}
              <line
                x1={x}
                y1={64}
                x2={x}
                y2={height - BOTTOM_PAD}
                stroke={color}
                strokeOpacity={0.28}
                strokeWidth={1}
                strokeDasharray="2 4"
              />
            </g>
          )
        })}

        {/* time ruler ticks on the left */}
        {events.map((ev, i) => (
          <g key={`tick-${ev.id}`}>
            {i % 1 === 0 && (
              <text
                x={LEFT_GUTTER - 10}
                y={eventY(i) + 3}
                textAnchor="end"
                fill="oklch(0.5 0.02 180)"
                fontSize={9}
                fontFamily="var(--font-geist-mono)"
              >
                {formatClock(ev.timestamp)}
              </text>
            )}
          </g>
        ))}

        {/* events */}
        {events.map((ev, i) => {
          const srcX = laneX(indexOf(ev.source))
          const tgtX = laneX(indexOf(ev.target))
          const y = eventY(i)
          const meta = EVENT_COLORS[ev.type as keyof typeof EVENT_COLORS] || { color: "#888", label: ev.type }
          const color = ev.status === "error" ? "#f87171" : meta.color
          const selected = ev.id === selectedId
          const isSelf = ev.source === ev.target
          const forward = tgtX >= srcX

          // arrow geometry
          const startX = srcX
          const endX = tgtX
          const len = Math.abs(endX - startX)
          const tok = ev.type === "llm_call" ? extractTokens(ev.payload) : null

          return (
            <g
              key={ev.id}
              className="cursor-pointer"
              onClick={() => onSelect(ev.id)}
            >
              {/* hit area */}
              <rect
                x={Math.min(startX, endX) - 8}
                y={y - 18}
                width={Math.max(16, len + 16)}
                height={36}
                fill="transparent"
              />

              {/* selection highlight */}
              {selected && (
                <rect
                  x={Math.min(startX, endX) - 10}
                  y={y - 20}
                  width={Math.max(20, len + 20)}
                  height={40}
                  rx={6}
                  fill={color}
                  fillOpacity={0.1}
                  stroke={color}
                  strokeOpacity={0.5}
                  strokeWidth={1}
                />
              )}

              {/* the arrow line (animated draw-in) */}
              {!isSelf ? (
                <motion.line
                  x1={startX}
                  y1={y}
                  x2={endX}
                  y2={y}
                  stroke={color}
                  strokeWidth={2}
                  strokeLinecap="round"
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 1 }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                  style={{ filter: `drop-shadow(0 0 4px ${color}66)` }}
                />
              ) : (
                <motion.path
                  d={`M ${startX} ${y} C ${startX + 40} ${y - 30}, ${startX + 40} ${y + 30}, ${startX} ${y}`}
                  fill="none"
                  stroke={color}
                  strokeWidth={2}
                  strokeLinecap="round"
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 1 }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                  style={{ filter: `drop-shadow(0 0 4px ${color}66)` }}
                />
              )}

              {/* arrowhead */}
              <motion.polygon
                points={arrowheadPoints(endX, y, forward, color)}
                fill={color}
                initial={{ opacity: 0, scale: 0 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.2, delay: 0.3 }}
                style={{ transformOrigin: `${endX}px ${y}px` }}
              />

              {/* source dot */}
              <motion.circle
                cx={startX}
                cy={y}
                r={3}
                fill={color}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ duration: 0.2, delay: 0.1 }}
              />

              {/* label */}
              <motion.g
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.25 }}
              >
                <text
                  x={(startX + endX) / 2}
                  y={y - 8}
                  textAnchor="middle"
                  fill="oklch(0.85 0.02 170)"
                  fontSize={10}
                  fontFamily="var(--font-geist-mono)"
                  className="pointer-events-none select-none"
                >
                  {truncate(ev.label || ev.type, 24)}
                </text>
                <text
                  x={(startX + endX) / 2}
                  y={y + 16}
                  textAnchor="middle"
                  fill={color}
                  fillOpacity={0.85}
                  fontSize={9}
                  fontFamily="var(--font-geist-mono)"
                  className="pointer-events-none select-none uppercase tracking-wider"
                >
                  {ev.type.replace("_", " ")}
                  {ev.durationMs != null ? ` · ${ev.durationMs}ms` : ""}
                  {tok ? ` · ${formatTokens(tok.total_tokens)} tok` : ""}
                </text>
              </motion.g>
            </g>
          )
        })}

        {/* live cursor at the bottom while running */}
        {live && (
          <g>
            <line
              x1={LEFT_GUTTER}
              y1={height - BOTTOM_PAD}
              x2={width - RIGHT_PAD}
              y2={height - BOTTOM_PAD}
              stroke="oklch(0.78 0.17 155)"
              strokeWidth={1}
              strokeOpacity={0.6}
            />
            <motion.circle
              cx={LEFT_GUTTER}
              cy={height - BOTTOM_PAD}
              r={4}
              fill="oklch(0.78 0.17 155)"
              animate={{ cx: [LEFT_GUTTER, width - RIGHT_PAD, LEFT_GUTTER] }}
              transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
              style={{ filter: "drop-shadow(0 0 6px oklch(0.78 0.17 155))" }}
            />
          </g>
        )}
      </svg>
    </div>
  )
}

function arrowheadPoints(x: number, y: number, forward: boolean, _color: string): string {
  const size = 6
  if (forward) {
    return `${x},${y} ${x - size},${y - size / 2} ${x - size},${y + size / 2}`
  }
  return `${x},${y} ${x + size},${y - size / 2} ${x + size},${y + size / 2}`
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s
}

function formatClock(iso: string): string {
  const d = new Date(iso)
  const h = String(d.getHours()).padStart(2, "0")
  const m = String(d.getMinutes()).padStart(2, "0")
  const s = String(d.getSeconds()).padStart(2, "0")
  const ms = String(d.getMilliseconds()).padStart(3, "0").slice(0, 2)
  return `${h}:${m}:${s}.${ms}`
}
