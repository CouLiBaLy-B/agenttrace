/** Each event's place on the transport bar's track, 0…1 in seq order: its time
 * since the first event over the run's span. A timestamp earlier than the one
 * before it is held at that one, so positions never go backwards; a run whose
 * events share one timestamp spreads them evenly by index. An unreadable
 * timestamp counts as the previous valid one. */
export function scrubberPositions(events: { seq: number; timestamp: string }[]): number[] {
  if (events.length === 0) return []
  if (events.length === 1) return [0]
  const raw = events.map((e) => new Date(e.timestamp).getTime())
  // An unreadable timestamp takes the previous valid time (the first valid one when it leads).
  const firstValid = raw.find((t) => !Number.isNaN(t)) ?? 0
  const times: number[] = []
  let last = firstValid
  for (const r of raw) {
    const t = Number.isNaN(r) ? last : Math.max(r, last)
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
