import { describe, expect, it } from "vitest"
import { clockTime } from "../format"

describe("clockTime", () => {
  it("prints local wall-clock time as HH:MM:SS.cc", () => {
    expect(clockTime(new Date(2026, 9, 3, 9, 5, 7, 128).toISOString())).toBe("09:05:07.12")
    expect(clockTime(new Date(2026, 9, 3, 0, 0, 0, 0).toISOString())).toBe("00:00:00.00")
    expect(clockTime(new Date(2026, 9, 3, 23, 59, 59, 999).toISOString())).toBe("23:59:59.99")
  })
  it("reads explicit UTC timestamps as local time", () => {
    const iso = "2026-10-03T12:00:00.500+00:00"
    const d = new Date(iso)
    const hh = String(d.getHours()).padStart(2, "0")
    expect(clockTime(iso)).toBe(`${hh}:${String(d.getMinutes()).padStart(2, "0")}:00.50`)
  })
  it("is empty for an unreadable timestamp", () => {
    expect(clockTime("not a date")).toBe("")
  })
})
