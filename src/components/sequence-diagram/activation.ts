import type { TraceEvent } from "@/lib/types"

export interface ActivationBar { lane: string; fromIndex: number; toIndex: number | null }

/** A tool_call to X opens a bar on X's lifeline; the next tool_result (or
 * error) whose source is X closes the oldest open bar on X. */
export function computeActivations(events: TraceEvent[]): ActivationBar[] {
  const open = new Map<string, number[]>()
  const bars: ActivationBar[] = []
  events.forEach((ev, i) => {
    if (ev.type === "tool_call") {
      open.set(ev.target, [...(open.get(ev.target) ?? []), i])
    } else if (ev.type === "tool_result" || ev.type === "error") {
      const queue = open.get(ev.source)
      if (queue?.length) bars.push({ lane: ev.source, fromIndex: queue.shift()!, toIndex: i })
    }
  })
  for (const [lane, queue] of open) for (const fromIndex of queue) bars.push({ lane, fromIndex, toIndex: null })
  return bars.sort((a, b) => a.fromIndex - b.fromIndex)
}

/** A bar placed on the rows of the diagram (indexes into the events it shows). */
export interface PlacedBar {
  lane: string
  /** The opening call's id. */
  key: string
  fromRow: number
  /** The closing row; x.5 when the closing event is filtered out (the bar ends
   * half a row after the last row shown before it); null while the tool works. */
  toRow: number | null
}

/** Pairs calls and results on the whole run (`all`), then places each bar on
 * the rows `shown` keeps after filtering: hiding results must not make every
 * tool look busy until the end. A call that is hidden has no bar. */
export function placeActivations(all: TraceEvent[], shown: TraceEvent[]): PlacedBar[] {
  const rowOf = new Map(shown.map((e, i) => [e.id, i]))
  // Rows shown before each event of the whole run.
  const before: number[] = []
  let rows = 0
  for (const e of all) {
    before.push(rows)
    if (rowOf.has(e.id)) rows++
  }
  return computeActivations(all).flatMap((bar) => {
    const key = all[bar.fromIndex].id
    const fromRow = rowOf.get(key)
    if (fromRow === undefined) return []
    const toRow = bar.toIndex === null ? null : (rowOf.get(all[bar.toIndex].id) ?? before[bar.toIndex] - 0.5)
    return [{ lane: bar.lane, key, fromRow, toRow }]
  })
}
