import { describe, expect, it } from "vitest"
import { computeActivations, placeActivations } from "../activation"
import type { TraceEvent } from "@/lib/types"

const ev = (i: number, source: string, target: string, type: TraceEvent["type"]): TraceEvent => ({
  id: `e${i}`, runId: "r", seq: i, timestamp: "2026-10-03T12:00:00+00:00", source, target, type,
  label: null, payload: {}, durationMs: null, status: "ok",
})

describe("computeActivations", () => {
  it("pairs each call with the next result from the same tool", () => {
    const events = [
      ev(0, "Orch", "search", "tool_call"),
      ev(1, "Orch", "calc", "tool_call"),
      ev(2, "calc", "Orch", "tool_result"),
      ev(3, "search", "Orch", "tool_result"),
    ]
    expect(computeActivations(events)).toEqual([
      { lane: "search", fromIndex: 0, toIndex: 3 },
      { lane: "calc", fromIndex: 1, toIndex: 2 },
    ])
  })
  it("an error from the tool also closes its bar", () => {
    const events = [ev(0, "Orch", "search", "tool_call"), ev(1, "search", "Orch", "error")]
    expect(computeActivations(events)).toEqual([{ lane: "search", fromIndex: 0, toIndex: 1 }])
  })
  it("unmatched calls stay open (null end)", () => {
    expect(computeActivations([ev(0, "Orch", "search", "tool_call")])).toEqual([{ lane: "search", fromIndex: 0, toIndex: null }])
  })
  it("results without a call are ignored", () => {
    expect(computeActivations([ev(0, "search", "Orch", "tool_result")])).toEqual([])
  })
})

describe("placeActivations", () => {
  const run = [
    ev(0, "Orch", "search", "tool_call"),
    ev(1, "Orch", "LLM", "llm_call"),
    ev(2, "LLM", "Orch", "llm_call"),
    ev(3, "search", "Orch", "tool_result"),
    ev(4, "Orch", "calc", "tool_call"),
  ]
  it("without a filter, bars sit on the pairing's own rows", () => {
    expect(placeActivations(run, run)).toEqual([
      { lane: "search", key: "e0", fromRow: 0, toRow: 3 },
      { lane: "calc", key: "e4", fromRow: 4, toRow: null },
    ])
  })
  it("pairs on the whole run: a hidden result ends its bar half a row after the last row shown before it", () => {
    const shown = run.filter((e) => e.type !== "tool_result")
    expect(placeActivations(run, shown)).toEqual([
      { lane: "search", key: "e0", fromRow: 0, toRow: 2.5 },
      { lane: "calc", key: "e4", fromRow: 3, toRow: null },
    ])
  })
  it("rows hidden inside a bar shorten it", () => {
    const shown = run.filter((e) => e.type !== "llm_call")
    expect(placeActivations(run, shown)[0]).toEqual({ lane: "search", key: "e0", fromRow: 0, toRow: 1 })
  })
  it("a hidden call has no bar", () => {
    const shown = run.filter((e) => e.type !== "tool_call")
    expect(placeActivations(run, shown)).toEqual([])
  })
})
