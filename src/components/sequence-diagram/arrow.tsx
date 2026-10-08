"use client"

import { memo, useEffect, useId, useRef, useState, type ReactNode } from "react"
import { cubicBezier, easeOut, motion, type MotionProps } from "framer-motion"
import type { DiagramStyle } from "@/lib/diagram-styles"
import type { ThemeId } from "@/lib/theme-core"
import { formatDuration } from "@/lib/api"
import { eventPaint } from "@/lib/types"
import { AFTERGLOW_REST, CASCADE_DRAW_MS, FADE_MS, isFresh, QUICK_MS, SPRING_REACH, type ArrivalPlan } from "./arrivals"
import type { ArrowGeom } from "./geometry"
import { sampleCubic, travelKeyframes, type Pt } from "./travel"

const PEN_EASE = cubicBezier(0.4, 0, 0.6, 1)
const SPRING = { stiffness: 380, damping: 26 }
const RIPPLE_MS = 700
const RIPPLE_R = 12
const DIMENSION_LAG_MS = 150 // Cyanotype: the dimension line is inked after the arrow
/** Longest arrival (Phosphore: 500 ms draw + 1.6 s afterglow) plus margin: the
 * arrow settles by then even if an animation never reports completion. */
const SETTLE_BACKSTOP_MS = 3500

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
  /** The line as a polyline, source to line end: the path a pulse or pen nib rides. */
  points: Pt[]
  /** Horizontal transform origin (0 = left edge, 1 = right) at the source end, for a line springing out. */
  sourceOrigin: 0 | 1
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
    const curve = sampleCubic({ x, y: top }, { x: x + LOOP_REACH, y: top }, { x: x + LOOP_REACH, y: tipY }, { x: tail, y: tipY }, 16)
    return {
      loop, dir, tipX, tipY, endX, crossX,
      points: [...curve, { x: endX, y: tipY }],
      sourceOrigin: 0,
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
    points: [{ x: a.x1, y: a.y }, { x: endX, y: a.y }],
    sourceOrigin: a.forward ? 0 : 1,
    path: (withGap) =>
      withGap
        ? `M ${a.x1} ${a.y} L ${gapFrom} ${a.y} M ${gapTo} ${a.y} L ${endX} ${a.y}`
        : `M ${a.x1} ${a.y} L ${endX} ${a.y}`,
    label: { x: mid, y: a.y - 8, anchor: "middle" },
    detail: { x: mid, y: a.y },
    box: { x0: Math.min(a.x1, a.x2) - 12, x1: Math.max(a.x1, a.x2) + 12, y0: a.y - 23, y1: a.y + 24 },
  }
}

type MotionSpec = Pick<MotionProps, "initial" | "animate" | "transition" | "style">
/** The parts of an arrow that can animate on arrival. */
type Part = "wrap" | "draw" | "line" | "head" | "source" | "text" | "duration" | "marker" | "ripple"
type Motions = Partial<Record<Part, MotionSpec>>

/** What each part does while `plan` plays, for this style. Durations divide by
 * the replay speed (plan.delayMs already does). */
function arrivalMotions(
  plan: ArrivalPlan,
  style: DiagramStyle,
  s: Shape,
  o: { selected: boolean; hasDuration: boolean; sourceDot: boolean },
): Motions {
  const sec = (ms: number) => ms / 1000 / plan.speed
  const delay = plan.delayMs / 1000
  const { drawMs: draw, settleMs: settle } = style.timing
  const fadeIn = (afterMs: number, overMs: number): MotionSpec => ({
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    transition: { delay: delay + sec(afterMs), duration: sec(overMs) },
  })
  const drawLine = (transition: MotionSpec["transition"]): MotionSpec => ({ initial: { pathLength: 0 }, animate: { pathLength: 1 }, transition })
  const ride = (ease: (t: number) => number): MotionSpec => {
    const { x, y } = travelKeyframes(s.points, ease)
    const travel = { delay, duration: sec(draw), ease: "linear" as const }
    const total = sec(draw + QUICK_MS)
    return {
      initial: { x: 0, y: 0, opacity: 0 },
      // Keyframes start at 0: opacity runs as a WAAPI animation that holds its
      // first keyframe through the delay.
      animate: { x, y, opacity: [0, 1, 1, 0] },
      transition: { x: travel, y: travel, opacity: { delay, duration: total, times: [0, 0.01, sec(draw) / total, 1] } },
    }
  }
  // Only parts the arrow draws: the arrow settles once each of them reports completion.
  const extras = (m: Motions, text: MotionSpec, source: MotionSpec): Motions => {
    const out: Motions = { ...m, text }
    if (o.hasDuration) out.duration = m.duration ?? text
    else delete out.duration
    if (o.sourceDot) out.source = source
    return out
  }

  switch (plan.kind) {
    case "fade":
      return { wrap: { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: FADE_MS / 1000 } } }
    case "cascade": {
      const transition = { delay, duration: CASCADE_DRAW_MS / 1000, ease: easeOut }
      return { wrap: { initial: { opacity: 0 }, animate: { opacity: 1 }, transition }, draw: drawLine(transition) }
    }
    case "pulse": {
      const landed = { delay: delay + sec(draw), duration: sec(RIPPLE_MS) }
      const m: Motions = {
        draw: drawLine({ delay, duration: sec(draw), ease: easeOut }),
        marker: ride(easeOut),
        head: fadeIn(draw, QUICK_MS),
        ripple: {
          initial: { scale: 0.1, opacity: 0 },
          animate: { scale: [0.1, 1], opacity: [0, 0.9, 0] },
          transition: { scale: { ...landed, ease: easeOut }, opacity: { ...landed, times: [0, 0.01, 1] } },
        },
      }
      if (style.afterglow) {
        m.line = {
          initial: { opacity: 1 },
          animate: { opacity: o.selected ? 1 : AFTERGLOW_REST },
          transition: o.selected ? { duration: QUICK_MS / 1000 } : { delay: delay + sec(draw), duration: sec(settle) },
        }
      }
      return extras(m, fadeIn(0, draw), fadeIn(0, QUICK_MS))
    }
    case "pen": {
      const lag = style.duration === "dimension" && !s.loop ? DIMENSION_LAG_MS : 0
      const m: Motions = {
        draw: drawLine({ delay, duration: sec(draw), ease: PEN_EASE }),
        marker: ride(PEN_EASE),
        head: fadeIn(draw, settle),
        duration: fadeIn(draw + lag, settle),
      }
      return extras(m, fadeIn(draw, settle), fadeIn(0, QUICK_MS))
    }
    case "spring": {
      // A spring s times faster with the same shape: stiffness × s², damping × s.
      const spring = { type: "spring" as const, stiffness: SPRING.stiffness * plan.speed ** 2, damping: SPRING.damping * plan.speed, delay }
      const pop = (afterMs: number, originX?: 0 | 1): MotionSpec => ({
        initial: { scale: 0 },
        animate: { scale: 1 },
        transition: { ...spring, delay: delay + sec(afterMs) },
        ...(originX !== undefined && { style: { originX } }),
      })
      const m: Motions = {
        line: { initial: { scaleX: 0 }, animate: { scaleX: 1 }, transition: spring, style: { originX: s.sourceOrigin } },
        head: pop(SPRING_REACH * draw, s.dir === 1 ? 1 : 0),
      }
      return extras(m, fadeIn(0.25 * draw, 0.5 * draw), pop(0))
    }
  }
}

/** Renders `children` animated by `m`, or as they are when there's nothing to play. */
function Animated({ m, onDone, children }: { m?: MotionSpec; onDone: () => void; children: ReactNode }) {
  if (!m) return <>{children}</>
  return (
    <motion.g initial={m.initial} animate={m.animate} transition={m.transition} style={m.style} onAnimationComplete={onDone}>
      {children}
    </motion.g>
  )
}

/** DOM id of an event's arrow (the canvas points aria-activedescendant at it). */
export function arrowDomId(eventId: string) {
  return `at-ev-${eventId.replace(/[^\w-]/g, "_")}`
}

/** Opacity of an arrow that doesn't match the active search. */
const MISS_OPACITY = 0.35

export interface ArrowProps {
  a: ArrowGeom
  /** Participant names as the event sent them (an unknown one is drawn on the first lane). */
  source: string
  target: string
  style: DiagramStyle
  selected: boolean
  onSelect: (id: string) => void
  /** How the event arrives when it is new (arrivals.ts). Read once, when the arrow mounts. */
  arrival?: ArrivalPlan
  /** With a search active: whether this event matches it (ringed) or not (dimmed). */
  match?: boolean
  /** Give the arrow its DOM id (the keyboard canvas points aria-activedescendant at it).
   * Off for decorative diagrams, so several on one page don't repeat ids. */
  domId?: boolean
}

/** One event: its line (dashed for a tool result), head, error cross, label and duration. */
export const Arrow = memo(function Arrow({ a, source, target, style, selected, onSelect, arrival, match, domId = true }: ArrowProps) {
  const { color, text: textColor, label: typeLabel } = eventPaint(a.type, a.isError)
  const detail = DETAIL[style.theme]
  const s = shapeOf(a, style)
  const { len, half } = headSize(style.arrow.width)
  const open = style.arrow.head === "open"
  const baseX = s.tipX - s.dir * len

  // The arrival plays once, from mount; an arrow mounted later (scrolled into
  // view) or after the plan has gone stays still.
  const [plan] = useState(() => (arrival && isFresh(arrival, performance.now()) ? arrival : null))
  const [settled, setSettled] = useState(plan === null)
  // A theme switch mid-arrival finishes it at once: the old theme's
  // choreography would play in the new style.
  const [planTheme] = useState(style.theme)
  if (!settled && style.theme !== planTheme) setSettled(true)
  const finished = useRef(new Set<Part>())
  const maskId = `at-draw-${useId().replace(/[^\w-]/g, "")}`
  useEffect(() => {
    if (!plan) return
    const backstop = setTimeout(() => setSettled(true), plan.delayMs + SETTLE_BACKSTOP_MS / plan.speed)
    return () => clearTimeout(backstop)
  }, [plan])

  const m = plan && !settled
    ? arrivalMotions(plan, style, s, { selected, hasDuration: a.durationMs != null, sourceDot: detail.sourceDot })
    : null
  const done = (part: Part) => () => {
    finished.current.add(part)
    if (m && finished.current.size >= Object.keys(m).length) setSettled(true)
  }

  // Keyboard focus stays on the canvas (it names the selected arrow through
  // aria-activedescendant), so arrows take no focus: a click focuses the canvas.
  return (
    <g
      id={domId ? arrowDomId(a.id) : undefined}
      role="button"
      aria-label={`${typeLabel} ${source} to ${target}: ${a.title}`}
      aria-current={selected ? "true" : undefined}
      data-event-id={a.id}
      data-arrival={m && plan!.kind !== "cascade" ? plan!.kind : undefined}
      data-match={match === undefined ? undefined : match}
      className="at-arrow"
      style={{ color, opacity: match === false ? MISS_OPACITY : undefined }}
      onClick={() => onSelect(a.id)}
    >
      {selected && (
        // The selection; with the canvas focused it also shows keyboard focus (globals.css).
        <rect
          className="at-arrow-sel"
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
      {match && (
        // A search hit: ringed in its own colour (selected too: the ring outlines the tint).
        <rect
          data-match-ring
          x={s.box.x0}
          y={s.box.y0}
          width={s.box.x1 - s.box.x0}
          height={s.box.y1 - s.box.y0}
          rx={detail.radius}
          fill="none"
          stroke={color}
          strokeWidth={1.25}
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

      <Animated m={m?.wrap} onDone={done("wrap")}>
        {m?.draw && (
          // Drawing reveals the line through a mask, so a dashed return keeps its dashes.
          <mask
            id={maskId}
            maskUnits="userSpaceOnUse"
            x={s.box.x0 - 10}
            y={s.box.y0 - 10}
            width={s.box.x1 - s.box.x0 + 20}
            height={s.box.y1 - s.box.y0 + 20}
          >
            <motion.path
              d={s.path(false)}
              fill="none"
              stroke="white"
              strokeWidth={style.arrow.width + 6}
              {...m.draw}
              onAnimationComplete={done("draw")}
            />
          </mask>
        )}
        <Animated m={m?.line} onDone={done("line")}>
          <path
            d={s.path(a.isError)}
            fill="none"
            stroke={color}
            strokeWidth={style.arrow.width}
            strokeDasharray={a.isReturn ? style.arrow.returnDash : undefined}
            strokeLinecap={open || a.isReturn ? "butt" : "round"}
            opacity={m?.line ? undefined : style.afterglow && !selected && !match ? AFTERGLOW_REST : 1}
            mask={m?.draw ? `url(#${maskId})` : undefined}
          />
        </Animated>
        <Animated m={m?.head} onDone={done("head")}>
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
        </Animated>
        {detail.sourceDot && (
          <Animated m={m?.source} onDone={done("source")}>
            <circle cx={a.x1} cy={s.loop ? a.y - LOOP_HALF : a.y} r={style.arrow.width * 1.25} fill={color} />
          </Animated>
        )}

        <Animated m={m?.text} onDone={done("text")}>
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
        </Animated>
        {a.durationMs != null && (
          <Animated m={m?.duration} onDone={done("duration")}>
            <Duration text={formatDuration(a.durationMs)} variant={style.duration} s={s} a={a} color={color} textColor={textColor} />
          </Animated>
        )}

        {m?.marker && (
          <motion.g {...m.marker} onAnimationComplete={done("marker")}>
            {plan!.kind === "pen" ? <Nib at={s.points[0]} /> : <PulseDot at={s.points[0]} color={color} />}
          </motion.g>
        )}
        {m?.ripple && (
          <motion.g {...m.ripple} onAnimationComplete={done("ripple")}>
            <circle cx={s.tipX} cy={s.tipY} r={RIPPLE_R} fill="none" stroke={color} strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
          </motion.g>
        )}
      </Animated>
      {/* Last child: the tooltip carries the full label without shadowing the visible text. */}
      <title>{a.title}</title>
    </g>
  )
})

/** Phosphore: the bright dot that carries a signal along its trace. */
function PulseDot({ at, color }: { at: Pt; color: string }) {
  return <circle cx={at.x} cy={at.y} r={2.6} fill="var(--ink)" style={{ filter: `drop-shadow(0 0 4px ${color})` }} />
}

/** Cyanotype: a plotter pen's nib, a ring on a crosshair. */
function Nib({ at }: { at: Pt }) {
  return (
    <g stroke="var(--ink)" strokeWidth={0.75} fill="none">
      <circle cx={at.x} cy={at.y} r={2.8} />
      <line x1={at.x - 6} x2={at.x + 6} y1={at.y} y2={at.y} />
      <line x1={at.x} x2={at.x} y1={at.y - 6} y2={at.y + 6} />
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
