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
