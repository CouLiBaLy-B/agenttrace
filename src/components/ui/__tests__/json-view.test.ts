import { describe, expect, it } from "vitest"
import { JSON_MAX_CHARS, JSON_MAX_TOKENS, JSON_PREVIEW_TOKENS, planJsonView, tokenizeJson } from "../json-view"

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

describe("planJsonView", () => {
  it("highlights a small payload in full", () => {
    const text = JSON.stringify({ a: [1, 2, 3], b: "x" }, null, 2)
    const plan = planJsonView(text)
    expect(plan.truncated).toBe(false)
    expect(plan.tokens.map((t) => t.text).join("")).toBe(text)
  })
  it("previews a payload over the size limit without tokenising all of it", () => {
    const text = JSON.stringify({ blob: "x".repeat(JSON_MAX_CHARS) })
    expect(text.length).toBeGreaterThan(JSON_MAX_CHARS)
    const plan = planJsonView(text)
    expect(plan.truncated).toBe(true)
    expect(plan.tokens.length).toBeLessThanOrEqual(JSON_PREVIEW_TOKENS)
    expect(text.startsWith(plan.tokens.map((t) => t.text).join(""))).toBe(true)
  })
  it("previews a payload over the token limit", () => {
    const text = JSON.stringify(new Array(JSON_MAX_TOKENS).fill(0))
    expect(text.length).toBeLessThanOrEqual(JSON_MAX_CHARS)
    const plan = planJsonView(text)
    expect(plan.truncated).toBe(true)
    expect(plan.tokens).toHaveLength(JSON_PREVIEW_TOKENS)
  })
  it("tokenizeJson stops at a limit", () => {
    expect(tokenizeJson("[1, 2, 3]", 3).map((t) => t.text)).toEqual(["[", "1", ","])
  })
})
