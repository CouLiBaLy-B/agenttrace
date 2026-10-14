import { describe, expect, it } from "vitest"
import { formatDuration } from "../api"

describe("formatDuration", () => {
  it("keeps ms, seconds and minutes as before", () => {
    expect(formatDuration(null)).toBe("—")
    expect(formatDuration(420)).toBe("420ms")
    expect(formatDuration(4300)).toBe("4.3s")
    expect(formatDuration(125_000)).toBe("2m 5s")
  })
  it("switches to hours and minutes from one hour", () => {
    expect(formatDuration(3_600_000)).toBe("1h 0m")
    expect(formatDuration(181 * 60_000 + 48_000)).toBe("3h 1m")
  })
})
