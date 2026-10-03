"use client"

import type { DiagramStyle } from "@/lib/diagram-styles"
import type { ThemeId } from "@/lib/theme-core"
import { formatDuration } from "@/lib/api"
import { EVENT_COLORS } from "@/lib/types"
import type { ArrowGeom } from "./geometry"

/** Opacity a Phosphore trace rests at once its afterglow has faded (spec: 100 % → 55 %). */
const AFTERGLOW_REST = 0.55

/** Small per-theme touches that don't warrant a DiagramStyle field. */
const DETAIL: Record<ThemeId, { labelWeight: number; sourceDot: boolean; radius: number }> = {
  phosphore: { labelWeight: 400, sourceDot: false, radius: 6 },
  cyanotype: { labelWeight: 400, sourceDot: false, radius: 2 },
  studio: { labelWeight: 500, sourceDot: true, radius: 9 },
}

const LABEL_CH = 6.2 // px per glyph of the 11 px UI label (as geometry.ts assumes)
const DATA_CH = 6 // px per glyph of a 9 px data font (the widest: Martian Mono, B612 Mono)
const LOOP_REACH = 44 // control-point reach of a self-message to the right of its lifeline
const LOOP_HALF = 9 // half the height of a self-message
const CROSS = 2.5 // half-size of the error cross (5 × 5 px)
const CROSS_GAP = 6 // half the gap the cross sits in
const UNKNOWN = { color: "var(--ink-3)", text: "var(--ink-2)" } // an event type this build does not know
/** A knockout around text in the colour behind it (--halo: the canvas, tinted
 * while the arrow is hovered or selected — globals.css), so lifelines and the
 * grid never run through a label. */
const HALO = { stroke: "var(--halo)", strokeWidth: 3, strokeLinejoin: "round", paintOrder: "stroke" } as const

function headSize(width: number) {
  return { len: 6 + 1.5 * width, half: 2.5 + 0.9 * width }
}

interface Shape {
  loop: boolean
  dir: 1 | -1 // the way the head points
  tipX: number
  tipY: number
  /** Where the line stops: just under the base of a filled head, at the vertex of an open one. */
  endX: number
  /** Centre of the error cross, on the line behind the head. */
  crossX: number
  path: (withGap: boolean) => string
  label: { x: number; y: number; anchor: "start" | "middle" }
  /** Duration anchor: centred under a straight arrow, left edge beside a self-message. */
  detail: { x: number; y: number }
  box: { x0: number; x1: number; y0: number; y1: number }
}

function shapeOf(a: ArrowGeom, style: DiagramStyle): Shape {
  const { len, half } = headSize(style.arrow.width)
  const open = style.arrow.head === "open"
  // An open chevron's mitred tip pokes past its vertex: pull it back onto the lifeline.
  const vertexInset = open ? style.arrow.width / 2 / Math.sin(Math.atan(half / len)) : 0
  const loop = a.selfLoop || a.x1 === a.x2
  const dir: 1 | -1 = loop || !a.forward ? -1 : 1
  const tipX = a.x2
  const tipY = loop ? a.y + LOOP_HALF : a.y
  const endX = open ? tipX - dir * vertexInset : tipX - dir * (len - 1)
  const crossX = (open ? endX : tipX) - dir * (len + 7)
  // The line runs ... → gapFrom, then gapTo → endX, leaving room for the cross.
  const gapFrom = crossX - dir * CROSS_GAP
  const gapTo = crossX + dir * CROSS_GAP

  if (loop) {
    const x = a.x1
    const top = a.y - LOOP_HALF
    const tail = crossX - dir * (CROSS_GAP + 4) // the curve lands here, then runs straight to the head
    const labelW = a.label.length * LABEL_CH
    return {
      loop, dir, tipX, tipY, endX, crossX,
      path: (withGap) =>
        `M ${x} ${top} C ${x + LOOP_REACH} ${top}, ${x + LOOP_REACH} ${tipY}, ${tail} ${tipY}` +
        (withGap ? ` L ${gapFrom} ${tipY} M ${gapTo} ${tipY}` : "") +
        ` L ${endX} ${tipY}`,
      label: { x: x + 8, y: top - 7, anchor: "start" },
      detail: { x: x + LOOP_REACH, y: a.y },
      box: { x0: x - 12, x1: x + Math.max(LOOP_REACH + 64, 8 + labelW) + 10, y0: top - 20, y1: tipY + 7 },
    }
  }

  const mid = (a.x1 + a.x2) / 2
  return {
    loop, dir, tipX, tipY, endX, crossX,
    path: (withGap) =>
      withGap
        ? `M ${a.x1} ${a.y} L ${gapFrom} ${a.y} M ${gapTo} ${a.y} L ${endX} ${a.y}`
        : `M ${a.x1} ${a.y} L ${endX} ${a.y}`,
    label: { x: mid, y: a.y - 8, anchor: "middle" },
    detail: { x: mid, y: a.y },
    box: { x0: Math.min(a.x1, a.x2) - 12, x1: Math.max(a.x1, a.x2) + 12, y0: a.y - 23, y1: a.y + 24 },
  }
}

export interface ArrowProps {
  a: ArrowGeom
  /** Participant names as the event sent them (an unknown one is drawn on the first lane). */
  source: string
  target: string
  style: DiagramStyle
  selected: boolean
  onSelect: (id: string) => void
}

/** One event: its line (dashed for a tool result), head, error cross, label and duration. */
export function Arrow({ a, source, target, style, selected, onSelect }: ArrowProps) {
  const meta = EVENT_COLORS[a.type] ?? { ...UNKNOWN, label: a.type }
  const color = a.isError ? EVENT_COLORS.error.color : meta.color
  const textColor = a.isError ? EVENT_COLORS.error.text : meta.text
  const detail = DETAIL[style.theme]
  const s = shapeOf(a, style)
  const { len, half } = headSize(style.arrow.width)
  const open = style.arrow.head === "open"
  const baseX = s.tipX - s.dir * len

  return (
    <g
      role="button"
      tabIndex={-1}
      aria-label={`${meta.label} ${source} to ${target}: ${a.title}`}
      aria-pressed={selected}
      data-event-id={a.id}
      className="at-arrow"
      style={{ color }}
      onClick={() => onSelect(a.id)}
    >
      {selected && (
        <rect
          x={s.box.x0}
          y={s.box.y0}
          width={s.box.x1 - s.box.x0}
          height={s.box.y1 - s.box.y0}
          rx={detail.radius}
          fill={color}
          fillOpacity={0.1}
          stroke={color}
          strokeOpacity={0.5}
          strokeWidth={1}
        />
      )}
      <rect
        className="at-arrow-hit"
        x={s.box.x0 + 4}
        y={s.label.y - 10}
        width={s.box.x1 - s.box.x0 - 8}
        height={36}
        rx={detail.radius}
        fill="transparent"
      />

      <path
        d={s.path(a.isError)}
        fill="none"
        stroke={color}
        strokeWidth={style.arrow.width}
        strokeDasharray={a.isReturn ? style.arrow.returnDash : undefined}
        strokeLinecap={open || a.isReturn ? "butt" : "round"}
        opacity={style.afterglow && !selected ? AFTERGLOW_REST : 1}
      />
      {open ? (
        <polyline
          points={`${s.endX - s.dir * len},${s.tipY - half} ${s.endX},${s.tipY} ${s.endX - s.dir * len},${s.tipY + half}`}
          fill="none"
          stroke={color}
          strokeWidth={style.arrow.width}
          strokeLinejoin="miter"
        />
      ) : (
        <polygon points={`${s.tipX},${s.tipY} ${baseX},${s.tipY - half} ${baseX},${s.tipY + half}`} fill={color} />
      )}
      {a.isError && (
        <g stroke="var(--ev-error)" strokeWidth={Math.max(1.5, style.arrow.width * 0.75)} strokeLinecap="round">
          <line x1={s.crossX - CROSS} y1={s.tipY - CROSS} x2={s.crossX + CROSS} y2={s.tipY + CROSS} />
          <line x1={s.crossX - CROSS} y1={s.tipY + CROSS} x2={s.crossX + CROSS} y2={s.tipY - CROSS} />
        </g>
      )}
      {detail.sourceDot && (
        <circle cx={a.x1} cy={s.loop ? a.y - LOOP_HALF : a.y} r={style.arrow.width * 1.25} fill={color} />
      )}

      <text
        x={s.label.x}
        y={s.label.y}
        textAnchor={s.label.anchor}
        fontFamily="var(--font-ui)"
        fontSize={11}
        fontWeight={detail.labelWeight}
        fill="var(--ink)"
        {...HALO}
      >
        {a.label}
      </text>
      {a.durationMs != null && (
        <Duration text={formatDuration(a.durationMs)} variant={style.duration} s={s} a={a} color={color} textColor={textColor} />
      )}
      {/* Last child: the tooltip carries the full label without shadowing the visible text. */}
      <title>{a.title}</title>
    </g>
  )
}

function Duration({
  text,
  variant,
  s,
  a,
  color,
  textColor,
}: {
  text: string
  variant: DiagramStyle["duration"]
  s: Shape
  a: ArrowGeom
  color: string
  textColor: string
}) {
  const { x, y } = s.detail
  const font = { fontFamily: "var(--font-data)", fontSize: 9, fill: textColor }

  if (variant === "chip") {
    const w = text.length * 5.2 + 14
    const h = 15
    const left = s.loop ? x : x - w / 2
    const top = s.loop ? y - h / 2 : y + 6
    return (
      <g>
        {/* Opaque (lifelines stop at its edge) and an 8 % tint, not 12 %: at 12 %
            the Studio handoff and result text colours fall below 4.5:1. */}
        <rect
          x={left}
          y={top}
          width={w}
          height={h}
          rx={h / 2}
          fill={`color-mix(in oklab, ${color} 8%, var(--canvas))`}
          stroke={`color-mix(in oklab, ${color} 30%, var(--canvas))`}
          strokeWidth={0.75}
        />
        <text x={left + w / 2} y={top + 10.7} textAnchor="middle" {...font}>
          {text}
        </text>
      </g>
    )
  }

  if (variant === "dimension" && !s.loop) {
    // A drawing's dimension line: extension lines, 45° ticks, the value on a knockout.
    const xa = Math.min(a.x1, a.x2) + 8
    const xb = Math.max(a.x1, a.x2) - 8
    const dy = y + 13
    const tw = text.length * DATA_CH + 8
    return (
      <g>
        <g stroke="var(--line-strong)" strokeWidth={0.75}>
          <line x1={xa} x2={xb} y1={dy} y2={dy} />
          <line x1={xa} x2={xa} y1={y + 4} y2={dy + 4} strokeOpacity={0.6} />
          <line x1={xb} x2={xb} y1={y + 4} y2={dy + 4} strokeOpacity={0.6} />
          <line x1={xa - 3} y1={dy + 3} x2={xa + 3} y2={dy - 3} strokeWidth={1} />
          <line x1={xb - 3} y1={dy + 3} x2={xb + 3} y2={dy - 3} strokeWidth={1} />
        </g>
        <rect x={x - tw / 2} y={dy - 6} width={tw} height={12} fill="var(--halo)" />
        <text x={x} y={dy + 3.2} textAnchor="middle" {...font}>
          {text}
        </text>
      </g>
    )
  }

  // "label" — and every duration beside a self-message
  return (
    <text x={x} y={s.loop ? y + 3.2 : y + 15} textAnchor={s.loop ? "start" : "middle"} {...font} {...HALO}>
      {text}
    </text>
  )
}
