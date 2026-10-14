import { describe, expect, it } from "vitest"
import { highlightLine, type Token } from "../highlight"

const kinds = (tokens: Token[]) => tokens.filter((t) => t.kind !== "plain").map((t) => [t.kind, t.text])
const joined = (tokens: Token[]) => tokens.map((t) => t.text).join("")

describe("highlightLine", () => {
  it("keeps the line's text unchanged", () => {
    const line = `    agenttrace.log_event(source="Orchestrator", type="llm_call")  # note`
    expect(joined(highlightLine(line))).toBe(line)
  })

  it("marks # and // comments to the end of the line", () => {
    expect(kinds(highlightLine("# pip install deepagents-trace"))).toEqual([["comment", "# pip install deepagents-trace"]])
    expect(kinds(highlightLine("  // 2. Append events"))).toEqual([["comment", "// 2. Append events"]])
    expect(kinds(highlightLine(`x = 1   # project-scoped key`))).toEqual([["comment", "# project-scoped key"]])
  })

  it("marks quoted strings, without reading comment markers inside them", () => {
    expect(kinds(highlightLine(`set_tracking_uri("http://localhost:3000")`))).toEqual([["string", `"http://localhost:3000"`]])
    expect(kinds(highlightLine(`label: "lookup_order(#4821)",`))).toEqual([
      ["key", "label"],
      ["string", `"lookup_order(#4821)"`],
    ])
    expect(kinds(highlightLine("throw new Error(`ingest failed: ${res.status}`);"))).toEqual([
      ["string", "`ingest failed: ${res.status}`"],
    ])
    expect(kinds(highlightLine(`pip install 'deepagents-trace[langchain]'`))).toEqual([["string", `'deepagents-trace[langchain]'`]])
  })

  it("keeps escaped quotes inside a string", () => {
    expect(kinds(highlightLine(`"a \\"b\\" c" d`))).toEqual([["string", `"a \\"b\\" c"`]])
  })

  it("marks object keys, keyword arguments and flags", () => {
    expect(kinds(highlightLine(`  "runId": "run_abc123",`))).toEqual([
      ["key", `"runId"`],
      ["string", `"run_abc123"`],
    ])
    expect(kinds(highlightLine(`log_event(source="Orchestrator")`))).toEqual([
      ["key", "source"],
      ["string", `"Orchestrator"`],
    ])
    expect(kinds(highlightLine(`agenttrace ui --auth none`))).toEqual([["key", "--auth"]])
  })

  it("leaves assignments and comparisons alone", () => {
    expect(kinds(highlightLine(`  const res = await fetch(url)`))).toEqual([])
    expect(kinds(highlightLine(`if a == b:`))).toEqual([])
  })
})
