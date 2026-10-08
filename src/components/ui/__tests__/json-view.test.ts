import { describe, expect, it } from "vitest"
import { tokenizeJson } from "../json-view"

describe("tokenizeJson", () => {
  it("classifies keys, strings, numbers, booleans, null", () => {
    const text = JSON.stringify({ a: "x", n: 1.5, b: true, z: null }, null, 2)
    const kinds = tokenizeJson(text).filter((t) => t.kind !== "space" && t.kind !== "punct")
    expect(kinds.map((t) => [t.kind, t.text])).toEqual([
      ["key", '"a"'], ["string", '"x"'], ["key", '"n"'], ["number", "1.5"],
      ["key", '"b"'], ["boolean", "true"], ["key", '"z"'], ["null", "null"],
    ])
  })
  it("round-trips the text exactly", () => {
    const text = JSON.stringify({ s: 'he said "hi"', list: [1, -2e3, false] }, null, 2)
    expect(tokenizeJson(text).map((t) => t.text).join("")).toBe(text)
  })
})
