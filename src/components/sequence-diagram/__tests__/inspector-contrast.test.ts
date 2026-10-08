import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { contrastRatio } from "@/lib/contrast"
import { BADGE_TINT } from "../event-badge"
import { JSON_TOKEN_COLOR } from "@/components/ui/json-view"

const css = readFileSync(fileURLToPath(new URL("../../../app/themes.css", import.meta.url)), "utf8")
const EVENTS = ["handoff", "llm", "tool", "result", "answer", "error"] as const

function resolver(theme: string) {
  const block = css.match(new RegExp(`\\[data-theme="${theme}"\\]\\s*\\{([^}]*)\\}`))![1]
  const t: Record<string, string> = {}
  for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) t[m[1]] = m[2].trim()
  return (name: string) => {
    let v = t[name]
    for (let i = 0; i < 4 && /^var\(/.test(v); i++) v = t[v.slice(4, -1)]
    return v
  }
}

/** `fg` at `alpha` over `bg`, composited in sRGB (a color-mix with transparent is drawn this way). */
function over(fg: string, alpha: number, bg: string): string {
  const ch = (hex: string, i: number) => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16)
  return "#" + [0, 1, 2].map((i) => Math.round(alpha * ch(fg, i) + (1 - alpha) * ch(bg, i)).toString(16).padStart(2, "0")).join("")
}

describe.each(["phosphore", "cyanotype", "studio"])("%s inspector", (theme) => {
  const tok = resolver(theme)
  it("type badge text reaches 4.5:1 on its tint over the panel and card surfaces", () => {
    expect(BADGE_TINT).toBeLessThanOrEqual(0.08)
    for (const surface of ["--surface-1", "--surface-2"])
      for (const e of EVENTS) {
        const bg = over(tok(`--ev-${e}`), BADGE_TINT, tok(surface))
        expect(contrastRatio(tok(`--ev-${e}-text`), bg), `${e} on ${surface}`).toBeGreaterThanOrEqual(4.5)
      }
  })
  it("JSON token colours reach 4.5:1 on the payload surface (surface-1)", () => {
    for (const [kind, v] of Object.entries(JSON_TOKEN_COLOR)) {
      if (kind === "space") continue
      const name = v.slice(4, -1)
      expect(contrastRatio(tok(name), tok("--surface-1")), `${kind} ${name}`).toBeGreaterThanOrEqual(4.5)
    }
  })
})
