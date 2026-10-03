import type { Participant, TraceEvent } from "@/lib/types"

export const LAYOUT = { laneWidth: 160, headerHeight: 64, rowHeight: 52, leftGutter: 84, rightPad: 32, bottomPad: 48 }
export type Layout = typeof LAYOUT
const CHAR_W = 6.2 // ≈ width of one 11 px UI glyph; labels are truncated by count, not measured

export interface ArrowGeom {
  id: string; index: number; x1: number; x2: number; y: number
  forward: boolean; selfLoop: boolean; isReturn: boolean; isError: boolean
  label: string; title: string; type: TraceEvent["type"]; durationMs: number | null; status: TraceEvent["status"]
}
export interface DiagramGeometry {
  width: number; height: number
  lanes: { name: string; kind: Participant["kind"]; x: number }[]
  arrows: ArrowGeom[]
}

export function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? text.slice(0, Math.max(1, maxChars - 1)) + "…" : text
}

export function laneLabel(name: string): string {
  return truncate(name, 17)
}

export function computeGeometry(events: TraceEvent[], participants: Participant[], layout: Layout = LAYOUT): DiagramGeometry {
  const laneX = (i: number) => layout.leftGutter + i * layout.laneWidth + layout.laneWidth / 2
  const index = new Map(participants.map((p, i) => [p.name, i]))
  const xOf = (name: string) => laneX(index.get(name) ?? 0)
  const lanes = participants.map((p, i) => ({ name: p.name, kind: p.kind, x: laneX(i) }))
  const arrows = events.map((ev, i): ArrowGeom => {
    const x1 = xOf(ev.source)
    const x2 = xOf(ev.target)
    const selfLoop = ev.source === ev.target
    const span = selfLoop ? layout.laneWidth * 0.8 : Math.abs(x2 - x1)
    const full = ev.label || ev.type.replace("_", " ")
    return {
      id: ev.id, index: i, x1, x2, y: layout.headerHeight + i * layout.rowHeight + layout.rowHeight / 2,
      forward: x2 >= x1, selfLoop, isReturn: ev.type === "tool_result",
      isError: ev.type === "error" || ev.status === "error",
      label: truncate(full, Math.max(12, Math.floor(span / CHAR_W))), title: full,
      type: ev.type, durationMs: ev.durationMs ?? null, status: ev.status,
    }
  })
  return {
    width: layout.leftGutter + participants.length * layout.laneWidth + layout.rightPad,
    height: layout.headerHeight + Math.max(1, events.length) * layout.rowHeight + layout.bottomPad,
    lanes,
    arrows,
  }
}
