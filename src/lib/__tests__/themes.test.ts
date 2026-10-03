import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { contrastRatio } from "@/lib/contrast"

const css = readFileSync(fileURLToPath(new URL("../../app/themes.css", import.meta.url)), "utf8")
const THEMES = ["phosphore", "cyanotype", "studio"] as const
const EVENTS = ["handoff", "llm", "tool", "result", "answer", "error"] as const
const REQUIRED = [
  "--surface-0", "--surface-1", "--surface-2", "--line", "--line-strong",
  "--ink", "--ink-2", "--ink-3",
  ...EVENTS.map((e) => `--ev-${e}`), ...EVENTS.map((e) => `--ev-${e}-text`),
  "--st-running", "--st-ok", "--st-failed",
  "--kind-user", "--kind-orchestrator", "--kind-llm", "--kind-tool", "--kind-subagent",
  "--font-ui", "--font-data", "--radius-panel", "--radius-control", "--shadow-raised", "--focus-ring",
]

function tokens(theme: string): Record<string, string> {
  const block = css.match(new RegExp(`\\[data-theme="${theme}"\\]\\s*\\{([^}]*)\\}`))
  if (!block) throw new Error(`no block for ${theme}`)
  const out: Record<string, string> = {}
  for (const m of block[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim()
  return out
}

describe.each(THEMES)("theme %s", (theme) => {
  const t = tokens(theme)
  const hex = (name: string) => {
    let v = t[name]
    const alias = v?.match(/^var\((--[\w-]+)\)$/)
    if (alias) v = t[alias[1]]
    if (!/^#[0-9a-fA-F]{6}$/.test(v ?? "")) throw new Error(`${theme} ${name} is not a hex colour: ${v}`)
    return v
  }

  it("defines every token", () => {
    for (const name of REQUIRED) expect(t[name], name).toBeDefined()
  })
  it("text tokens reach 4.5:1 on surface-1", () => {
    for (const name of ["--ink", "--ink-2", ...EVENTS.map((e) => `--ev-${e}-text`)])
      expect(contrastRatio(hex(name), hex("--surface-1")), name).toBeGreaterThanOrEqual(4.5)
  })
  it("tertiary ink and status reach 3:1 on surface-1", () => {
    for (const name of ["--ink-3", "--st-running", "--st-ok", "--st-failed"])
      expect(contrastRatio(hex(name), hex("--surface-1")), name).toBeGreaterThanOrEqual(3)
  })
  it("event strokes reach 3:1 on surface-0", () => {
    for (const e of EVENTS) expect(contrastRatio(hex(`--ev-${e}`), hex("--surface-0")), e).toBeGreaterThanOrEqual(3)
  })
})

describe("contrastRatio", () => {
  it("matches WCAG reference values", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1)
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2)
  })
})
