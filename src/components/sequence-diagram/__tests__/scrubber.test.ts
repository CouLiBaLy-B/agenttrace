import { describe, expect, it } from "vitest"
import { indexAtPosition, scrubberPositions } from "../scrubber"

const at = (...ms: number[]) => ms.map((t, i) => ({ seq: i, timestamp: new Date(1_700_000_000_000 + t).toISOString() }))

describe("scrubberPositions", () => {
  it("relative time from first to last", () => {
    expect(scrubberPositions(at(0, 500, 1000))).toEqual([0, 0.5, 1])
  })
  it("equal timestamps spread evenly", () => {
    expect(scrubberPositions(at(0, 0, 0, 0))).toEqual([0, 1 / 3, 2 / 3, 1])
  })
  it("out-of-order timestamps never go backwards (seq wins)", () => {
    const p = scrubberPositions(at(0, 1000, 400, 2000))
    expect(p).toEqual([...p].sort((a, b) => a - b))
    expect(p[0]).toBe(0)
    expect(p[3]).toBe(1)
  })
  it("single and empty", () => {
    expect(scrubberPositions(at(0))).toEqual([0])
    expect(scrubberPositions([])).toEqual([])
  })
})

describe("indexAtPosition", () => {
  const p = [0, 0.2, 0.9, 1]
  it("nearest event", () => {
    expect(indexAtPosition(p, 0.15)).toBe(1)
    expect(indexAtPosition(p, 0.6)).toBe(2)
    expect(indexAtPosition(p, 2)).toBe(3)
    expect(indexAtPosition(p, -1)).toBe(0)
  })
  it("ties go to the lower index", () => {
    expect(indexAtPosition([0, 1], 0.5)).toBe(0)
  })
})
