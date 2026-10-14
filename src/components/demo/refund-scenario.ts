import type { TraceEvent } from "@/lib/types"

export type ScenarioStep = { at: number; event: Omit<TraceEvent, "id" | "runId" | "timestamp" | "seq"> }

/** The "refund" run the sign-in screen and the theme previews play: `at` is
 * when each event arrives, in ms from the start of the loop. */
export const REFUND_SCENARIO: ScenarioStep[] = [
  {
    at: 600,
    event: { source: "User", target: "Orchestrator", type: "handoff", label: "refund request", payload: { message: "I'd like a refund for order 4821" }, status: "ok" },
  },
  {
    at: 1500,
    event: { source: "Orchestrator", target: "LLM", type: "llm_call", label: "classify intent", payload: { model: "gpt-4o-mini", intent: "refund" }, durationMs: 480, status: "ok" },
  },
  {
    at: 2500,
    event: { source: "Orchestrator", target: "lookup_order", type: "tool_call", label: "lookup_order(4821)", payload: { orderId: "4821" }, status: "ok" },
  },
  {
    at: 3400,
    event: { source: "lookup_order", target: "Orchestrator", type: "tool_result", label: "order found", payload: { orderId: "4821", total: 59.9, refundable: true }, durationMs: 220, status: "ok" },
  },
  {
    at: 4300,
    event: { source: "Orchestrator", target: "User", type: "final_answer", label: "refund issued", payload: { orderId: "4821", amount: 59.9 }, status: "ok" },
  },
]

/** The scenario's events that have arrived `elapsedMs` into the loop. */
export function scenarioEvents(elapsedMs: number, base = Date.UTC(2026, 9, 3, 12)): TraceEvent[] {
  return REFUND_SCENARIO.filter((s) => s.at <= elapsedMs).map((s, i) => ({
    ...s.event,
    id: `demo-${i}`,
    runId: "demo",
    seq: i,
    timestamp: new Date(base + s.at).toISOString(),
  }))
}
