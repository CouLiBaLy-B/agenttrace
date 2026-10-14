import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { contrastRatio } from "@/lib/contrast"
import { AFTERGLOW_REST } from "../arrivals"

const css = readFileSync(fileURLToPath(new URL("../../../app/themes.css", import.meta.url)), "utf8")
const block = css.match(/\[data-theme="phosphore"\]\s*\{([^}]*)\}/)![1]
const token = (name: string) => block.match(new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{6})`))![1]

/** `fg` at `alpha` over `bg`, composited in sRGB as the browser does for SVG opacity. */
function over(fg: string, alpha: number, bg: string): string {
  const ch = (hex: string, i: number) => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16)
  return "#" + [0, 1, 2].map((i) => Math.round(alpha * ch(fg, i) + (1 - alpha) * ch(bg, i)).toString(16).padStart(2, "0")).join("")
}

describe("Phosphore afterglow", () => {
  it.each(["handoff", "llm", "tool", "result", "answer", "error"])("a %s trace at rest keeps 3:1 on surface-0", (e) => {
    const surface = token("--surface-0")
    expect(contrastRatio(over(token(`--ev-${e}`), AFTERGLOW_REST, surface), surface)).toBeGreaterThanOrEqual(3)
  })
})
