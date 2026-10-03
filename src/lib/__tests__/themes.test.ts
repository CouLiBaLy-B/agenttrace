import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { contrastRatio } from "@/lib/contrast"

const css = readFileSync(fileURLToPath(new URL("../../app/themes.css", import.meta.url)), "utf8")
const THEMES = ["phosphore", "cyanotype", "studio"] as const
const EVENTS = ["handoff", "llm", "tool", "result", "answer", "error"] as const
const KINDS = ["user", "orchestrator", "llm", "tool", "subagent"] as const
const REQUIRED = [
  "--surface-0", "--surface-1", "--surface-2", "--line", "--line-strong",
  "--ink", "--ink-2", "--ink-3",
  ...EVENTS.map((e) => `--ev-${e}`), ...EVENTS.map((e) => `--ev-${e}-text`),
  "--st-running", "--st-ok", "--st-failed",
  "--action", "--on-action", "--danger", "--on-danger",
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
    for (let hops = 0; hops < 4; hops++) {
      const alias = v?.match(/^var\((--[\w-]+)\)$/)
      if (!alias) break
      v = t[alias[1]]
    }
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
  it("action and danger buttons reach 4.5:1 for their label", () => {
    expect(contrastRatio(hex("--on-action"), hex("--action")), "on-action on action").toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(hex("--on-danger"), hex("--danger")), "on-danger on danger").toBeGreaterThanOrEqual(4.5)
  })
  it("action and danger used as text reach 4.5:1 on surface-0 and surface-1", () => {
    for (const name of ["--action", "--danger"])
      for (const surface of ["--surface-0", "--surface-1"])
        expect(contrastRatio(hex(name), hex(surface)), `${name} on ${surface}`).toBeGreaterThanOrEqual(4.5)
  })
  it("toast text reaches 4.5:1 on surface-2, the popover colour sonner draws on", () => {
    // sonner.tsx sets plain / success / error / info / warning toast text to these tokens
    for (const name of ["--ink", "--action", "--danger", "--ev-llm-text", "--ev-handoff-text"])
      expect(contrastRatio(hex(name), hex("--surface-2")), `${name} on --surface-2`).toBeGreaterThanOrEqual(4.5)
  })
  it("kind tokens alias defined event tokens", () => {
    for (const k of KINDS) {
      const target = t[`--kind-${k}`]?.match(/^var\((--ev-(?:handoff|llm|tool|result|answer|error))\)$/)?.[1]
      expect(target, `--kind-${k} must be var(--ev-<event>)`).toBeDefined()
      expect(t[target!], `${target} (target of --kind-${k})`).toBeDefined()
    }
  })
})

describe("contrastRatio", () => {
  it("matches WCAG reference values", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1)
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2)
  })
})
