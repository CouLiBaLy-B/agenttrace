import type { RunStatus } from "@/lib/types"

/** Horizontal placement of runs on a [from, to] window `width` px wide. Running
 * runs extend to `to` ("now"); a run with no end that is not running (it
 * crashed) gets the minimum width. Everything is clamped to the window. */
export function chronoLayout(
  runs: { startedAt: string; endedAt: string | null; status: RunStatus }[],
  from: number,
  to: number,
  width: number,
  minWidth = 4,
): { x: number; w: number; startedBefore: boolean; live: boolean }[] {
  const span = Math.max(1, to - from)
  const px = (t: number) => ((t - from) / span) * width
  return runs.map((r) => {
    const start = new Date(r.startedAt).getTime()
    const live = r.status === "running"
    const end = r.endedAt ? new Date(r.endedAt).getTime() : live ? to : start
    const x = Math.min(width, Math.max(0, px(start)))
    const right = Math.min(width, Math.max(x, px(Math.max(end, start))))
    return { x, w: Math.max(minWidth, right - x), startedBefore: start < from, live }
  })
}

/** `count + 1` evenly spaced ticks (x in 0..1), labelled in hours before now. */
export function chronoTicks(from: number, to: number, count = 4): { x: number; label: string }[] {
  const hours = Math.round((to - from) / 3_600_000)
  return Array.from({ length: count + 1 }, (_, i) => {
    const left = Math.round(hours * (1 - i / count))
    return { x: i / count, label: i === count ? "now" : `−${left} h` }
  })
}
