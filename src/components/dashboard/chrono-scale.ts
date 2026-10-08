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

/** `count + 1` evenly spaced ticks (x in 0..1), labelled in time before now:
 * in days on a window longer than a day when every tick lands on a whole day,
 * otherwise in hours. */
export function chronoTicks(from: number, to: number, count = 4): { x: number; label: string }[] {
  const hours = Math.round((to - from) / 3_600_000)
  const lefts = Array.from({ length: count + 1 }, (_, i) => Math.round(hours * (1 - i / count)))
  const days = hours > 24 && lefts.every((h) => h % 24 === 0)
  return lefts.map((left, i) => ({
    x: i / count,
    label: i === count ? "now" : days ? `−${left / 24} d` : `−${left} h`,
  }))
}
