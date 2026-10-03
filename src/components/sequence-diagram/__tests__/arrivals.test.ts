import { describe, expect, it } from "vitest"
import { advanceTrack, ARRIVAL_BURST, ARRIVAL_STAGGER_MS, classifyArrivals, isFresh, MOUNT_SLACK_MS, SPRING_REACH, type TrackOptions } from "../arrivals"
import { DIAGRAM_STYLES } from "@/lib/diagram-styles"
import type { TraceEvent } from "@/lib/types"

describe("classifyArrivals", () => {
  const ids = Array.from({ length: 50 }, (_, i) => `e${i}`)
  it("first render: first 40 cascade, the rest are instant", () => {
    const r = classifyArrivals(null, ids)
    expect(r.cascade).toEqual(ids.slice(0, 40))
    expect(r.arrivals).toEqual([])
  })
  it("later renders: only unseen ids arrive", () => {
    const r = classifyArrivals(new Set(ids.slice(0, 48)), ids)
    expect(r.cascade).toEqual([])
    expect(r.arrivals).toEqual(["e48", "e49"])
  })
  it("respects a custom cascade cap", () => {
    expect(classifyArrivals(null, ids.slice(0, 5), 3).cascade).toEqual(["e0", "e1", "e2"])
  })
})

describe("advanceTrack", () => {
  const ev = (i: number, source = "Orch", target = "LLM", type: TraceEvent["type"] = "llm_call", status: TraceEvent["status"] = "ok"): TraceEvent => ({
    id: `e${i}`, runId: "r", seq: i, timestamp: "2026-10-03T12:00:00+00:00", source, target, type,
    label: null, payload: {}, durationMs: null, status,
  })
  const evs = (n: number) => Array.from({ length: n }, (_, i) => ev(i))
  const opts = (o: Partial<TrackOptions> = {}): TrackOptions => ({
    style: DIAGRAM_STYLES.phosphore, reducedMotion: false, speed: 1, inView: { start: 0, end: 12 }, now: 1000, ...o,
  })
  const ids = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => `e${from + i}`)

  it("opening a run cascades the rows in view over cascadeMs", () => {
    const t = advanceTrack(null, evs(100), opts({ inView: { start: 50, end: 60 } }))
    expect([...t.plans.keys()]).toEqual(ids(50, 60))
    expect(t.plans.get("e50")).toEqual({ kind: "cascade", delayMs: 0, speed: 1, at: 1000 })
    expect(t.plans.get("e55")!.delayMs).toBe((5 * 400) / 10)
    expect(t.seen.size).toBe(100)
  })
  it("the opening cascade stops after 40 rows", () => {
    const t = advanceTrack(null, evs(100), opts({ inView: { start: 0, end: 60 } }))
    expect([...t.plans.keys()]).toEqual(ids(0, 40))
  })
  it("a live run opened empty: its first events arrive rather than cascade", () => {
    const t = advanceTrack(null, evs(1), opts({ openingCascade: false }))
    expect(t.plans.get("e0")).toEqual({ kind: "pulse", delayMs: 0, speed: 1, at: 1000 })
  })
  it("new events get the theme's arrival, a small batch staggered in order", () => {
    const t0 = advanceTrack(null, evs(3), opts())
    const t1 = advanceTrack(t0, evs(5), opts({ now: 2000, style: DIAGRAM_STYLES.cyanotype }))
    expect([...t1.plans.entries()]).toEqual([
      ["e3", { kind: "pen", delayMs: 0, speed: 1, at: 2000 }],
      ["e4", { kind: "pen", delayMs: ARRIVAL_STAGGER_MS, speed: 1, at: 2000 }],
    ])
    expect(advanceTrack(t1, evs(5), opts()).plans.size).toBe(0)
  })
  it("a burst of arrivals is drawn like the opening cascade, on the rows in view", () => {
    const t0 = advanceTrack(null, evs(2), opts())
    const t1 = advanceTrack(t0, evs(2 + ARRIVAL_BURST + 20), opts({ inView: { start: 18, end: 30 } }))
    expect([...t1.plans.keys()]).toEqual(ids(18, 30))
    expect(new Set([...t1.plans.values()].map((p) => p.kind))).toEqual(new Set(["cascade"]))
  })
  it("replay speed scales the stagger; instant replay animates nothing", () => {
    const t0 = advanceTrack(null, evs(1), opts())
    const fast = advanceTrack(t0, evs(3), opts({ speed: 2 }))
    expect(fast.plans.get("e2")).toMatchObject({ delayMs: ARRIVAL_STAGGER_MS / 2, speed: 2 })
    const instant = advanceTrack(t0, evs(3), opts({ speed: 0 }))
    expect(instant.plans.size).toBe(0)
    expect(instant.seen.has("e2")).toBe(true)
    expect(advanceTrack(null, evs(3), opts({ speed: 0 })).plans.size).toBe(0)
  })
  it("reduced motion turns every arrival and cascade into a fade, all at once", () => {
    const opening = advanceTrack(null, evs(3), opts({ reducedMotion: true }))
    expect([...opening.plans.values()]).toEqual(Array(3).fill({ kind: "fade", delayMs: 0, speed: 1, at: 1000 }))
    const later = advanceTrack(opening, evs(5), opts({ reducedMotion: true }))
    expect([...later.plans.values()].map((p) => [p.kind, p.delayMs])).toEqual([["fade", 0], ["fade", 0]])
  })
  it("events cut from the end (replay rewinding) arrive again; events hidden in the middle do not", () => {
    const all = evs(5)
    const t0 = advanceTrack(null, all, opts())
    const rewound = advanceTrack(t0, all.slice(0, 2), opts())
    expect([...advanceTrack(rewound, all.slice(0, 3), opts()).plans.keys()]).toEqual(["e2"])
    const hidden = advanceTrack(t0, [all[0], all[2], all[3], all[4]], opts())
    expect(advanceTrack(hidden, all, opts()).plans.size).toBe(0)
  })
  it("in a style with LEDs an arrival lights its target's LED until it is replaced", () => {
    const studio = DIAGRAM_STYLES.studio
    const call = ev(0, "Orch", "search", "tool_call")
    const failed = ev(1, "search", "Orch", "tool_result", "error")
    const t0 = advanceTrack(null, [call], opts({ style: studio }))
    expect(t0.flashes).toEqual({})
    const t1 = advanceTrack(t0, [call, failed], opts({ style: studio, now: 3000 }))
    expect(t1.flashes).toEqual({
      Orch: { key: "e1", color: "var(--ev-error)", delayMs: SPRING_REACH * 420, durationMs: 1100, at: 3000 },
    })
    const t2 = advanceTrack(t1, [call, failed, ev(2, "Orch", "LLM")], opts({ style: studio }))
    expect(Object.keys(t2.flashes).sort()).toEqual(["LLM", "Orch"])
    expect(t2.flashes.LLM.color).toBe("var(--ev-llm)")
    expect(advanceTrack(null, evs(1), opts({ openingCascade: false })).flashes).toEqual({})
  })
})

describe("isFresh", () => {
  it("lets an arrow that mounts with its plan play it, not one scrolled into view later", () => {
    const plan = { at: 1000, delayMs: 300 }
    expect(isFresh(plan, 1000)).toBe(true)
    expect(isFresh(plan, 1000 + 300 + MOUNT_SLACK_MS)).toBe(true)
    expect(isFresh(plan, 1000 + 300 + MOUNT_SLACK_MS + 1)).toBe(false)
  })
})
