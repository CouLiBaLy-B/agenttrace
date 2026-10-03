import { describe, expect, it } from "vitest"
import { computeGeometry, LAYOUT, laneLabel, truncate } from "../geometry"
import type { Participant, TraceEvent } from "@/lib/types"

const ev = (i: number, source: string, target: string, type: TraceEvent["type"], extra: Partial<TraceEvent> = {}): TraceEvent => ({
  id: `e${i}`, runId: "r", seq: i, timestamp: new Date(1_700_000_000_000 + i * 1000).toISOString(),
  source, target, type, label: `${type} ${i}`, payload: {}, durationMs: null, status: "ok", ...extra,
})
const P = (name: string, kind: Participant["kind"] = "tool"): Participant => ({ id: name, name, kind, icon: kind })

describe("computeGeometry", () => {
  const parts = [P("User", "user"), P("Orchestrator", "orchestrator"), P("web_search")]
  const events = [
    ev(0, "User", "Orchestrator", "handoff"),
    ev(1, "Orchestrator", "web_search", "tool_call"),
    ev(2, "web_search", "Orchestrator", "tool_result", { durationMs: 1500 }),
    ev(3, "web_search", "Orchestrator", "error", { status: "error" }),
    ev(4, "Orchestrator", "Orchestrator", "llm_call"),
  ]
  const g = computeGeometry(events, parts)

  it("places lanes on the lane grid", () => {
    expect(g.lanes.map((l) => l.x)).toEqual([0, 1, 2].map((i) => LAYOUT.leftGutter + i * LAYOUT.laneWidth + LAYOUT.laneWidth / 2))
    expect(g.width).toBe(LAYOUT.leftGutter + 3 * LAYOUT.laneWidth + LAYOUT.rightPad)
  })
  it("one row per event, below the header", () => {
    expect(g.arrows.map((a) => a.y)).toEqual(events.map((_, i) => LAYOUT.headerHeight + i * LAYOUT.rowHeight + LAYOUT.rowHeight / 2))
    expect(g.height).toBe(LAYOUT.headerHeight + events.length * LAYOUT.rowHeight + LAYOUT.bottomPad)
  })
  it("direction, return, error and self loops", () => {
    expect(g.arrows[1].forward).toBe(true)
    expect(g.arrows[2].forward).toBe(false)
    expect(g.arrows[2].isReturn).toBe(true)
    expect(g.arrows[1].isReturn).toBe(false)
    expect(g.arrows[3].isError).toBe(true)
    expect(g.arrows[4].selfLoop).toBe(true)
  })
  it("unknown participants fall back to the first lane", () => {
    const g2 = computeGeometry([ev(0, "Ghost", "User", "handoff")], parts)
    expect(g2.arrows[0].x1).toBe(g.lanes[0].x)
  })
  it("empty run still has a drawable height", () => {
    expect(computeGeometry([], parts).height).toBe(LAYOUT.headerHeight + LAYOUT.rowHeight + LAYOUT.bottomPad)
  })
  it("labels fit the arrow; full text kept as title", () => {
    const long = ev(0, "User", "Orchestrator", "handoff", { label: "x".repeat(80) })
    const a = computeGeometry([long], parts).arrows[0]
    expect(a.label.length).toBeLessThan(80)
    expect(a.label.endsWith("…")).toBe(true)
    expect(a.title).toBe("x".repeat(80))
  })
})

describe("text helpers", () => {
  it("truncate", () => {
    expect(truncate("hello", 10)).toBe("hello")
    expect(truncate("hello world", 6)).toBe("hello…")
  })
  it("laneLabel caps long participant names", () => {
    expect(laneLabel("a_very_long_tool_name_for_testing")).toBe("a_very_long_tool…")
    expect(laneLabel("LLM")).toBe("LLM")
  })
})
