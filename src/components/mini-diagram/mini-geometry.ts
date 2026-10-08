import type { EventType, RunShape } from "@/lib/types"

export interface MiniArrow {
  x1: number
  x2: number
  y: number
  type: EventType
  isReturn: boolean
  isError: boolean
  selfLoop: boolean
}

/** Lanes spread evenly across the box, one row per event, top to bottom. */
export function miniGeometry(shape: RunShape, width: number, height: number, pad = 6): { lanes: number[]; arrows: MiniArrow[] } {
  const n = shape.participants.length
  if (n === 0) return { lanes: [], arrows: [] }
  const laneW = (width - 2 * pad) / n
  const lanes = shape.participants.map((_, i) => Math.round(pad + laneW * (i + 0.5)))
  const rows = Math.max(1, shape.events.length)
  const rowH = (height - 2 * pad) / rows
  const arrows = shape.events.map((e, i): MiniArrow => ({
    x1: lanes[e.s] ?? lanes[0],
    x2: lanes[e.t] ?? lanes[0],
    y: pad + rowH * (i + 0.5),
    type: e.type,
    isReturn: e.type === "tool_result",
    isError: e.type === "error" || e.status === "error",
    selfLoop: e.s === e.t,
  }))
  return { lanes, arrows }
}
