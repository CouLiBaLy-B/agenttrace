import type { DiagramStyle } from "@/lib/diagram-styles"
import { eventPaint, type TraceEvent } from "@/lib/types"

export function classifyArrivals(seen: ReadonlySet<string> | null, ids: string[], cascadeCap = 40) {
  if (seen === null) return { cascade: ids.slice(0, cascadeCap), arrivals: [] as string[] }
  return { cascade: [] as string[], arrivals: ids.filter((id) => !seen.has(id)) }
}

/** More arrivals than this in one update (a replay seek, a polling batch) are drawn like the opening cascade. */
export const ARRIVAL_BURST = 8
/** Gap between the arrivals of one small batch, so they read in order. */
export const ARRIVAL_STAGGER_MS = 120
/** Length of one row's fade-and-draw in a cascade (the whole cascade still ends within cascadeMs). */
export const CASCADE_DRAW_MS = 160
/** A head lighting up, a marker going out, a bar appearing. */
export const QUICK_MS = 150
/** The only arrival with reduced motion. */
export const FADE_MS = 120
/** Share of drawMs after which a springing line reaches its target (head pops, LED lights). */
export const SPRING_REACH = 0.35

/** How long after its plan an arrow may mount and still play it (it mounts in
 * the same render, give or take a slow frame). */
export const MOUNT_SLACK_MS = 250

/** Whether an animation planned at `p.at` may still start: an arrow scrolled
 * into view later stays still. */
export function isFresh(p: { at: number; delayMs: number }, now: number): boolean {
  return now - p.at <= p.delayMs + MOUNT_SLACK_MS
}

/** Opacity a Phosphore trace rests at once its afterglow has faded. The spec
 * says 55 %; 60 % keeps every trace at 3:1 on --surface-0 (afterglow.test.ts). */
export const AFTERGLOW_REST = 0.6

/** "cascade": a row of the opening cascade; "fade": any arrival with reduced motion. */
export type ArrivalKind = DiagramStyle["arrival"] | "fade" | "cascade"

export interface ArrivalPlan {
  kind: ArrivalKind
  /** Wait before this event starts to draw (cascade spread, or its place in a batch). */
  delayMs: number
  /** Replay speed the durations are divided by (1 when live). */
  speed: number
  /** performance.now() when planned: an arrow that mounts later (scrolled into view) stays still. */
  at: number
}

/** A participant LED lit by an arrival (styles with LEDs). */
export interface LedFlash {
  /** The event that lit it: a new key restarts the flash. */
  key: string
  color: string
  delayMs: number
  durationMs: number
  at: number
}

export interface ArrivalTrack {
  ids: string[]
  /** Ids already drawn: they never animate again, even when scrolled back into view. */
  seen: ReadonlySet<string>
  /** Animations started by the latest update, by event id. */
  plans: ReadonlyMap<string, ArrivalPlan>
  /** Latest flash per lane; kept so a running flash isn't restarted or cut. */
  flashes: Readonly<Record<string, LedFlash>>
}

export interface TrackOptions {
  style: DiagramStyle
  reducedMotion: boolean
  /** Replay speed (1 when live); 0 = instant, nothing animates. */
  speed: number
  /** Rows inside the viewport, [start, end). */
  inView: { start: number; end: number }
  now: number
  /** First update only: false makes the events already there arrivals (a live run opened while empty). */
  openingCascade?: boolean
}

/** Works out which events animate after the event list changed, and how. Pure
 * (the caller passes the clock): the diagram keeps the result in state. */
export function advanceTrack(prev: ArrivalTrack | null, events: TraceEvent[], o: TrackOptions): ArrivalTrack {
  const ids = events.map((e) => e.id)
  const plans = new Map<string, ArrivalPlan>()
  const flashes = { ...prev?.flashes }
  const { style, reducedMotion: reduced, speed, now: at } = o

  const cascade = (list: string[]) => {
    const { cascade: rows } = classifyArrivals(null, list)
    rows.forEach((id, i) =>
      plans.set(id, reduced
        ? { kind: "fade", delayMs: 0, speed: 1, at }
        // Spread so the last row's fade-and-draw ends at cascadeMs.
        : { kind: "cascade", delayMs: (i * (style.timing.cascadeMs - CASCADE_DRAW_MS)) / Math.max(1, rows.length - 1), speed: 1, at }),
    )
  }

  if (speed > 0) {
    if (prev === null && o.openingCascade !== false) {
      cascade(ids.slice(o.inView.start, o.inView.end))
    } else {
      const { arrivals } = classifyArrivals(prev?.seen ?? new Set(), ids)
      if (arrivals.length > ARRIVAL_BURST) {
        const inView = new Set(ids.slice(o.inView.start, o.inView.end))
        cascade(arrivals.filter((id) => inView.has(id)))
      } else {
        const byId = new Map(events.map((e) => [e.id, e]))
        arrivals.forEach((id, i) => {
          const delayMs = reduced ? 0 : (i * ARRIVAL_STAGGER_MS) / speed
          plans.set(id, { kind: reduced ? "fade" : style.arrival, delayMs, speed, at })
          if (style.decorations.includes("leds")) {
            const ev = byId.get(id)!
            flashes[ev.target] = {
              key: id,
              color: eventPaint(ev.type, ev.type === "error" || ev.status === "error").color,
              delayMs: reduced ? 0 : delayMs + (SPRING_REACH * style.timing.drawMs) / speed,
              durationMs: style.timing.settleMs / speed,
              at,
            }
          }
        })
      }
    }
  }

  // Events cut from the end of the list (replay rewinding) are forgotten, so
  // they arrive again; events hidden from the middle (a filter) stay seen.
  const seen = new Set(prev?.seen)
  if (prev) {
    const present = new Set(ids)
    for (let i = prev.ids.length - 1; i >= 0 && !present.has(prev.ids[i]); i--) seen.delete(prev.ids[i])
  }
  for (const id of ids) seen.add(id)

  return { ids, seen, plans, flashes }
}
