import { describe, expect, it } from "vitest"
import { sampleCubic, travelKeyframes } from "../travel"

const linear = (t: number) => t

describe("travelKeyframes", () => {
  it("follows a straight line evenly with a linear ease (offsets from the start)", () => {
    expect(travelKeyframes([{ x: 10, y: 5 }, { x: 110, y: 5 }], linear, 4)).toEqual({ x: [0, 25, 50, 75, 100], y: [0, 0, 0, 0, 0] })
  })
  it("applies the ease to the distance travelled", () => {
    expect(travelKeyframes([{ x: 0, y: 0 }, { x: 100, y: 0 }], (t) => t * t, 2).x).toEqual([0, 25, 100])
  })
  it("walks a polyline by arc length", () => {
    const k = travelKeyframes([{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 30 }], linear, 4)
    expect(k.x).toEqual([0, 15, 30, 30, 30])
    expect(k.y).toEqual([0, 0, 0, 15, 30])
  })
  it("runs right to left for a returning arrow", () => {
    expect(travelKeyframes([{ x: 200, y: 0 }, { x: 40, y: 0 }], linear, 2).x).toEqual([0, -80, -160])
  })
})

describe("sampleCubic", () => {
  it("starts and ends on the end points and bulges toward the controls", () => {
    const pts = sampleCubic({ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 20 }, { x: 0, y: 20 }, 4)
    expect(pts).toHaveLength(5)
    expect(pts[0]).toEqual({ x: 0, y: 0 })
    expect(pts[4]).toEqual({ x: 0, y: 20 })
    expect(pts[2]).toEqual({ x: 30, y: 10 })
  })
})
