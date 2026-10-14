import { describe, expect, it } from "vitest"
import { nextSelection } from "../selection"

const ids = ["a", "b", "c"]
describe("nextSelection", () => {
  it("moves within bounds", () => {
    expect(nextSelection(ids, "a", "ArrowDown")).toBe("b")
    expect(nextSelection(ids, "c", "ArrowDown")).toBe("c")
    expect(nextSelection(ids, "a", "ArrowUp")).toBe("a")
  })
  it("starts from the edges when nothing is selected", () => {
    expect(nextSelection(ids, null, "ArrowDown")).toBe("a")
    expect(nextSelection(ids, null, "ArrowUp")).toBe("c")
  })
  it("Home / End / Escape", () => {
    expect(nextSelection(ids, "b", "Home")).toBe("a")
    expect(nextSelection(ids, "b", "End")).toBe("c")
    expect(nextSelection(ids, "b", "Escape")).toBeNull()
  })
  it("selection hidden by a filter restarts from the edge", () => {
    expect(nextSelection(ids, "zzz", "ArrowDown")).toBe("a")
  })
  it("empty list", () => {
    expect(nextSelection([], null, "ArrowDown")).toBeNull()
  })
})
