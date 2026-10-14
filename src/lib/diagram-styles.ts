import type { ThemeId } from "@/lib/theme-core"

export interface DiagramStyle {
  theme: ThemeId
  header: "box" | "titled" | "tile"
  lifeline: { dash: string; width: number }
  arrow: { width: number; head: "filled" | "open"; returnDash: string }
  arrival: "pulse" | "pen" | "spring"
  afterglow: boolean
  duration: "label" | "dimension" | "chip"
  decorations: Array<"vignette" | "titleBlock" | "leds">
  timing: { drawMs: number; settleMs: number; cascadeMs: number }
}

export const DIAGRAM_STYLES: Record<ThemeId, DiagramStyle> = {
  phosphore: {
    theme: "phosphore", header: "box", lifeline: { dash: "1.5 3", width: 0.8 },
    arrow: { width: 1.6, head: "filled", returnDash: "5 4" }, arrival: "pulse", afterglow: true,
    duration: "label", decorations: ["vignette"], timing: { drawMs: 500, settleMs: 1600, cascadeMs: 400 },
  },
  cyanotype: {
    theme: "cyanotype", header: "titled", lifeline: { dash: "7 2 1.2 2", width: 0.7 },
    arrow: { width: 1.2, head: "open", returnDash: "5 3" }, arrival: "pen", afterglow: false,
    duration: "dimension", decorations: ["titleBlock"], timing: { drawMs: 550, settleMs: 300, cascadeMs: 400 },
  },
  studio: {
    theme: "studio", header: "tile", lifeline: { dash: "", width: 1 },
    arrow: { width: 2.6, head: "filled", returnDash: "6 5" }, arrival: "spring", afterglow: false,
    duration: "chip", decorations: ["leds"], timing: { drawMs: 420, settleMs: 1100, cascadeMs: 400 },
  },
}
