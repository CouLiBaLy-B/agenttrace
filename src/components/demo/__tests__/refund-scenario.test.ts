import { describe, expect, it } from "vitest"
import { REFUND_SCENARIO, scenarioEvents } from "../refund-scenario"

describe("refund scenario", () => {
  it("has the five spec events in order", () => {
    expect(REFUND_SCENARIO.map((s) => [s.event.source, s.event.target, s.event.type])).toEqual([
      ["User", "Orchestrator", "handoff"],
      ["Orchestrator", "LLM", "llm_call"],
      ["Orchestrator", "lookup_order", "tool_call"],
      ["lookup_order", "Orchestrator", "tool_result"],
      ["Orchestrator", "User", "final_answer"],
    ])
    expect(REFUND_SCENARIO[1].event.durationMs).toBe(480)
    expect(REFUND_SCENARIO[3].event.durationMs).toBe(220)
  })
  it("reveals events over time", () => {
    expect(scenarioEvents(0)).toHaveLength(0)
    expect(scenarioEvents(1600).map((e) => e.id)).toEqual(["demo-0", "demo-1"])
    expect(scenarioEvents(10_000)).toHaveLength(5)
    expect(scenarioEvents(10_000).map((e) => e.seq)).toEqual([0, 1, 2, 3, 4])
  })
})
