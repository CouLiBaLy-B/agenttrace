import type { EventType, TraceEvent } from "@/lib/types"

/** The run view's filters: `hidden` event types leave the diagram; `query`
 * (case-insensitive, over label, participants and type) only marks matches,
 * so the diagram can highlight them and dim the rest. Empty query → no matches. */
export function filterEvents(events: TraceEvent[], hidden: ReadonlySet<EventType>, query: string) {
  const visible = events.filter((e) => !hidden.has(e.type))
  const q = query.trim().toLowerCase()
  const matches = new Set<string>()
  if (q) {
    for (const e of visible) {
      const hay = [e.label ?? "", e.source, e.target, e.type].join(" ").toLowerCase()
      if (hay.includes(q)) matches.add(e.id)
    }
  }
  return { visible, matches }
}
