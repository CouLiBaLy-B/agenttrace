/** Each event's place on the transport bar's track, 0…1 in seq order: its time
 * since the first event over the run's span. A timestamp earlier than the one
 * before it is held at that one, so positions never go backwards; a run whose
 * events share one timestamp spreads them evenly by index. */
export function scrubberPositions(events: { seq: number; timestamp: string }[]): number[] {
  if (events.length === 0) return []
  if (events.length === 1) return [0]
  const times: number[] = []
  let last = -Infinity
  for (const e of events) {
    const t = Math.max(new Date(e.timestamp).getTime(), last)
    times.push(t)
    last = t
  }
  const span = times[times.length - 1] - times[0]
  if (span <= 0) return times.map((_, i) => i / (times.length - 1))
  return times.map((t) => (t - times[0]) / span)
}

/** The index of the position nearest to `p` (ties go to the lower index). */
export function indexAtPosition(positions: number[], p: number): number {
  let best = 0
  for (let i = 1; i < positions.length; i++) {
    if (Math.abs(positions[i] - p) < Math.abs(positions[best] - p)) best = i
  }
  return best
}
