import { describe, expect, it } from "vitest"
import { filterEvents } from "@/lib/run-filters"
import type { TraceEvent } from "@/lib/types"

const ev = (i: number, type: TraceEvent["type"], label: string): TraceEvent => ({
  id: `e${i}`, runId: "r", seq: i, timestamp: "2026-10-03T12:00:00+00:00", source: "Orch", target: "web_search",
  type, label, payload: {}, durationMs: null, status: "ok",
})
const events = [ev(0, "llm_call", "classify intent"), ev(1, "tool_call", "web_search(rust)"), ev(2, "error", "timeout")]

describe("filterEvents", () => {
  it("hides filtered types, keeps order", () => {
    expect(filterEvents(events, new Set(["error"]), "").visible.map((e) => e.id)).toEqual(["e0", "e1"])
  })
  it("search highlights without removing", () => {
    const r = filterEvents(events, new Set(), "RUST")
    expect(r.visible).toHaveLength(3)
    expect([...r.matches]).toEqual(["e1"])
  })
  it("search also matches participants and type", () => {
    expect(filterEvents(events, new Set(), "llm").matches.has("e0")).toBe(true)
    expect(filterEvents(events, new Set(), "web_search").matches.size).toBe(3)
  })
  it("empty query matches nothing", () => {
    expect(filterEvents(events, new Set(), "  ").matches.size).toBe(0)
  })
})
