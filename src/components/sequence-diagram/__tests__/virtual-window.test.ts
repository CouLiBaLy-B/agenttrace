import { describe, expect, it } from "vitest"
import { OVERSCAN, rowsInView, VIRTUALIZE_THRESHOLD, visibleRange } from "../virtual-window"

describe("visibleRange", () => {
  it("renders everything at or below the threshold", () => {
    expect(visibleRange(VIRTUALIZE_THRESHOLD, 5000, 600, 52, 64)).toEqual({ start: 0, end: VIRTUALIZE_THRESHOLD })
  })
  it("windows around the viewport with overscan", () => {
    const r = visibleRange(1000, 64 + 100 * 52, 520, 52, 64)
    expect(r.start).toBe(100 - OVERSCAN)
    expect(r.end).toBe(100 + 11 + OVERSCAN)
  })
  it("clamps at both ends", () => {
    expect(visibleRange(1000, 0, 520, 52, 64).start).toBe(0)
    expect(visibleRange(1000, 10_000_000, 520, 52, 64).end).toBe(1000)
  })
})

describe("rowsInView", () => {
  it("lists the rows the viewport shows, with no overscan and no threshold", () => {
    expect(rowsInView(50, 64 + 10 * 52, 520, 52, 64)).toEqual({ start: 10, end: 21 })
    expect(rowsInView(50, 0, 520, 52, 64)).toEqual({ start: 0, end: 11 })
  })
  it("clamps to the number of events", () => {
    expect(rowsInView(5, 0, 520, 52, 64)).toEqual({ start: 0, end: 5 })
    expect(rowsInView(5, 10_000, 520, 52, 64)).toEqual({ start: 5, end: 5 })
  })
})
