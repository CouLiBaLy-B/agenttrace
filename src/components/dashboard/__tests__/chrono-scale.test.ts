import { describe, expect, it } from "vitest"
import { chronoLayout, chronoTicks } from "../chrono-scale"

const H = 3_600_000
const from = Date.UTC(2026, 9, 3, 0, 0, 0)
const to = from + 24 * H
const iso = (t: number) => new Date(t).toISOString()

describe("chronoLayout", () => {
  it("positions by start time and sizes by duration", () => {
    const [r] = chronoLayout([{ startedAt: iso(from + 12 * H), endedAt: iso(from + 18 * H), status: "completed" }], from, to, 240)
    expect(r.x).toBeCloseTo(120)
    expect(r.w).toBeCloseTo(60)
    expect(r.live).toBe(false)
  })
  it("enforces a minimum width for short runs", () => {
    const [r] = chronoLayout([{ startedAt: iso(from + H), endedAt: iso(from + H + 1000), status: "completed" }], from, to, 240)
    expect(r.w).toBe(4)
  })
  it("running runs extend to now", () => {
    const [r] = chronoLayout([{ startedAt: iso(from + 20 * H), endedAt: null, status: "running" }], from, to, 240)
    expect(r.x + r.w).toBeCloseTo(240)
    expect(r.live).toBe(true)
  })
  it("crashed runs (no end, not running) get the minimum width", () => {
    const [r] = chronoLayout([{ startedAt: iso(from + 2 * H), endedAt: null, status: "failed" }], from, to, 240)
    expect(r.w).toBe(4)
    expect(r.live).toBe(false)
  })
  it("runs that started before the window are clamped to the left edge", () => {
    const [r] = chronoLayout([{ startedAt: iso(from - 5 * H), endedAt: null, status: "running" }], from, to, 240)
    expect(r.x).toBe(0)
    expect(r.startedBefore).toBe(true)
    expect(r.w).toBeCloseTo(240)
  })
  it("never returns NaN or negative widths", () => {
    const rows = chronoLayout([{ startedAt: iso(from + 3 * H), endedAt: iso(from + 2 * H), status: "completed" }], from, to, 240)
    expect(rows[0].w).toBeGreaterThanOrEqual(4)
    expect(Number.isNaN(rows[0].x)).toBe(false)
  })
})

describe("chronoLayout with unreadable timestamps", () => {
  it("marks a run whose start cannot be read as unplaceable, with finite numbers", () => {
    const rows = chronoLayout(
      [
        { startedAt: "not a date", endedAt: iso(from + 2 * H), status: "completed" },
        { startedAt: iso(from + 12 * H), endedAt: iso(from + 18 * H), status: "completed" },
      ],
      from,
      to,
      240,
    )
    expect(rows[0]).toEqual({ x: 0, w: 0, startedBefore: false, live: false, placeable: false })
    expect(rows[1]).toMatchObject({ placeable: true })
    expect(rows[1].x).toBeCloseTo(120)
  })
  it("treats an unreadable end like a missing one", () => {
    const [done, live] = chronoLayout(
      [
        { startedAt: iso(from + 2 * H), endedAt: "garbage", status: "failed" },
        { startedAt: iso(from + 20 * H), endedAt: "garbage", status: "running" },
      ],
      from,
      to,
      240,
    )
    expect(done).toMatchObject({ x: 20, w: 4, placeable: true })
    expect(Number.isFinite(live.w)).toBe(true)
    expect(live.x + live.w).toBeCloseTo(240)
  })
})

describe("chronoTicks", () => {
  it("labels a 24 h window", () => {
    expect(chronoTicks(from, to).map((t) => t.label)).toEqual(["−24 h", "−18 h", "−12 h", "−6 h", "now"])
    expect(chronoTicks(from, to).map((t) => t.x)).toEqual([0, 0.25, 0.5, 0.75, 1])
  })

  it("labels whole days in days on a window longer than a day", () => {
    expect(chronoTicks(from, from + 168 * H, 7).map((t) => t.label)).toEqual([
      "−7 d", "−6 d", "−5 d", "−4 d", "−3 d", "−2 d", "−1 d", "now",
    ])
  })

  it("keeps hours when a tick falls between days", () => {
    expect(chronoTicks(from, from + 168 * H, 2).map((t) => t.label)).toEqual(["−168 h", "−84 h", "now"])
  })
})
