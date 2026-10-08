import { describe, expect, it } from "vitest"
import { miniGeometry } from "../mini-geometry"

describe("miniGeometry", () => {
  const shape = {
    participants: ["User", "Orch", "LLM", "tool"],
    events: [
      { s: 0, t: 1, type: "handoff" as const, status: "ok" as const },
      { s: 1, t: 3, type: "tool_call" as const, status: "ok" as const },
      { s: 3, t: 1, type: "tool_result" as const, status: "ok" as const },
      { s: 1, t: 1, type: "llm_call" as const, status: "error" as const },
    ],
  }
  it("spreads lanes across the width", () => {
    const g = miniGeometry(shape, 160, 60)
    expect(g.lanes).toEqual([25, 62, 99, 136])
  })
  it("rows stay inside the box and keep order", () => {
    const g = miniGeometry(shape, 160, 60)
    const ys = g.arrows.map((a) => a.y)
    expect(ys).toEqual([...ys].sort((a, b) => a - b))
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(6)
    expect(Math.max(...ys)).toBeLessThanOrEqual(54)
  })
  it("flags returns, errors and self loops", () => {
    const g = miniGeometry(shape, 160, 60)
    expect(g.arrows[2].isReturn).toBe(true)
    expect(g.arrows[3].isError).toBe(true)
    expect(g.arrows[3].selfLoop).toBe(true)
  })
  it("empty and single-participant shapes do not produce NaN", () => {
    expect(miniGeometry({ participants: [], events: [] }, 100, 40)).toEqual({ lanes: [], arrows: [] })
    const one = miniGeometry({ participants: ["A"], events: [{ s: 0, t: 0, type: "llm_call", status: "ok" }] }, 100, 40)
    expect(one.lanes).toEqual([50])
    expect(Number.isNaN(one.arrows[0].y)).toBe(false)
  })
})
