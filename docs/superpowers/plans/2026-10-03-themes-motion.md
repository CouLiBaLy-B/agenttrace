# Themes & Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three complete, switchable themes (Phosphore, Cyanotype, Studio) with a per-theme motion personality, a redesigned run view, dashboard (stat strip + chronogram + run feed), projects, entry surfaces, and the demo-time bug fixes.

**Architecture:** CSS custom properties per theme on `[data-theme=…]` (attribute selectors, so any subtree can carry its own theme), aliased to the existing shadcn variables. One SVG diagram renderer parameterised by a per-theme `DiagramStyle`. All layout maths live in pure, unit-tested modules (Vitest). Two small FastAPI endpoints feed the chronogram and the mini diagrams.

**Tech Stack:** Next.js 16 static export, React 19, TanStack Query, zustand, framer-motion, Tailwind 4, @fontsource fonts, Vitest (new), FastAPI/SQLAlchemy, pytest, Playwright (Python).

**Spec:** `docs/superpowers/specs/2026-10-03-themes-motion-design.md`

## Global Constraints

- Branch `feat/themes-motion` (based on `feat/bundled-ui`). Frontend checks: `export PATH=$HOME/.bun/bin:$PATH`; `bun run lint`, `bun run typecheck`, `bun run test` (Vitest, from Task 1), `bun run build:ui`. Python: `.venv/bin/pytest python-server/tests -q`; e2e: `.venv/bin/pytest python-server/tests_e2e -q` (needs a fresh `bun run build:ui`).
- Theme ids exactly `phosphore`, `cyanotype`, `studio`; preference adds `auto`. Storage key `agenttrace-theme`. Auto: OS dark → `cyanotype`, OS light → `studio`.
- Token names exactly as in the spec's token table (`--surface-0/1/2`, `--line`, `--line-strong`, `--ink`, `--ink-2`, `--ink-3`, `--ev-handoff|llm|tool|result|answer|error`, `--ev-*-text`, `--st-running|ok|failed`, `--font-ui`, `--font-data`, `--radius-panel`, `--radius-control`, `--shadow-raised`, `--focus-ring`) plus `--kind-user|orchestrator|llm|tool|subagent` (aliases of event tokens, see Task 1).
- Palette hex values: the spec's tables, **except** these Studio corrections required by the spec's own contrast rule (strokes ≥ 3:1 on `--surface-0`, tertiary ink ≥ 3:1 on `--surface-1`): `--ev-handoff` / `--st-running` `#E25200` (spec `#FF6A13` = 2.29:1), `--ev-result` / `--st-ok` `#0C8F52` (spec `#12B76A` = 2.09:1), `--ink-3` `#7D8490` (spec `#8A919C` = 2.94:1). Studio text variants: handoff `#B84400`, llm `#2457D6`, tool `#6236E0`, result `#0B7A47`, answer `#C21E5F`, error `#B3202A`. Dark themes: `--ev-*-text` = their stroke colour.
- Contrast rules (unit-tested): `--ink`, `--ink-2`, every `--ev-*-text` ≥ 4.5:1 on `--surface-1`; `--ink-3` and every `--st-*` ≥ 3:1 on `--surface-1`; every `--ev-*` stroke ≥ 3:1 on `--surface-0`.
- Fonts: `@fontsource/instrument-sans` (400, 600), `@fontsource/martian-mono` (400, 500), `@fontsource/b612` (400, 700), `@fontsource/b612-mono` (400), `@fontsource/bricolage-grotesque` (500, 700), `@fontsource/dm-mono` (400, 500). `geist` is removed.
- Motion numbers: draw/settle — Phosphore 500/1600 ms, Cyanotype 550/300 ms, Studio 420 ms spring (stiffness 380, damping 26) / 1100 ms LED; cascade ≤ 400 ms over at most the first 40 visible rows; reduced motion = 120 ms fade, no travel; theme reveal ≈ 450 ms circle (fallback 200 ms colour transition, none with reduced motion); boot ≤ 1.2 s, once per page load.
- Virtualisation above 200 events, overscan 20 rows. Mini diagrams: first 12 events. Timeline: `hours` 1–168 (default 24), cap 500 runs + `truncated`. Recent: `limit` 1–50 (default 12).
- Keyboard in the run view: ↑/↓ move selection, Home/End first/last, Esc clears.
- No `cx`/`cy` attribute animation anywhere (use transforms).
- Commits end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` (any Claude model name is fine for subagents).
- Copy: sentence case, plain verbs, no ALL-CAPS labels in new UI, errors say what happened and how to fix it.

## Review Focus

1. **Theme switch while a live run is animating or replaying** — the diagram keeps its selection, replay position and live subscription (no remount); in-flight arrival animations finish or snap, never duplicate. Covered: Task 13 e2e `test_theme_switch_mid_run_keeps_selection`.
2. **Many / long participants (12+ lanes, 40-char names)** — horizontal scroll, sticky headers truncate with a native tooltip (`<title>`), nothing overlaps. Covered: Task 3 geometry tests (truncation + width) and Task 13 e2e with a 12-participant run (no console errors, horizontally scrollable).
3. **Odd timestamps** — equal or out-of-order timestamps (seq is authoritative), runs with `endedAt = null` that are not running (crashed), zero-duration runs: scrubber, chronogram and mini diagrams must not produce NaN or negative widths. Covered: Task 6 `scrubberPositions` tests, Task 9 `chronoLayout` tests.
4. **`localStorage` unavailable** (private mode, blocked storage) — theme resolves to auto, switching still works for the session, no exception. Covered: Task 2 theme tests with a throwing storage.
5. **Fresh install, no projects / no runs** — dashboard, projects and chronogram show the direction-giving empty states (with "Load demo projects"), never a blank panel or a crash. Covered: Task 13 e2e `test_fresh_install_empty_states`.

---

## File Structure

```
src/app/themes.css                         CREATE  three theme token blocks + canvas classes + view-transition CSS
src/app/globals.css                        MODIFY  import themes.css, alias shadcn vars to tokens, dark variant, drop old palette
src/app/layout.tsx                         MODIFY  fonts, head boot script, no className="dark"
src/lib/contrast.ts                        CREATE  WCAG contrast helpers
src/lib/theme.ts                           CREATE  ids, resolve, storage, boot script, store, applyTheme
src/lib/diagram-styles.ts                  CREATE  DiagramStyle per theme
src/lib/run-filters.ts                     CREATE  type filter + search
src/lib/types.ts                           MODIFY  EVENT_COLORS → token vars, labels
src/components/theme/theme-switcher.tsx    CREATE  sidebar swatches + auto
src/components/theme/theme-sync.tsx        CREATE  hydrate store from DOM, follow OS changes
src/components/sequence-diagram/geometry.ts        CREATE  lane/row/arrow geometry
src/components/sequence-diagram/arrivals.ts        CREATE  cascade/new-event classification
src/components/sequence-diagram/activation.ts      CREATE  activation bars
src/components/sequence-diagram/virtual-window.ts  CREATE  visible row range
src/components/sequence-diagram/scrubber.ts        CREATE  scrubber positions / index lookup
src/components/sequence-diagram/selection.ts       CREATE  keyboard selection
src/components/sequence-diagram/themed-diagram.tsx CREATE  SVG renderer (replaces lifeline-diagram.tsx)
src/components/sequence-diagram/arrow.tsx          CREATE  one event: line, head, label, duration, arrival animation
src/components/sequence-diagram/lane-headers.tsx   CREATE  sticky header row (box | titled | tile + LEDs)
src/components/sequence-diagram/decorations.tsx    CREATE  vignette, title block
src/components/sequence-diagram/transport-bar.tsx  CREATE  play/speed/scrubber/back-to-live (replaces replay-controls.tsx)
src/components/sequence-diagram/filter-bar.tsx     CREATE  type chips + search
src/components/sequence-diagram/event-detail-panel.tsx MODIFY inspector redesign
src/components/sequence-diagram/stacked-timeline.tsx  MODIFY mobile restyle
src/components/sequence-diagram/sequence-diagram.tsx  MODIFY wire everything
src/components/ui/json-view.tsx            CREATE  JSON tokenizer + coloured view
src/components/mini-diagram/mini-geometry.ts   CREATE
src/components/mini-diagram/mini-diagram.tsx   CREATE  static + live variants
src/components/dashboard/run-feed.tsx      CREATE
src/components/dashboard/chrono-scale.ts   CREATE
src/components/dashboard/chronogram.tsx    CREATE
src/components/dashboard/stat-strip.tsx    CREATE
src/components/demo/refund-scenario.ts     CREATE
src/components/demo/demo-loop.tsx          CREATE
src/components/boot-screen.tsx             MODIFY  per-theme boot sequences
src/components/views/*.tsx                 MODIFY  dashboard, projects, project detail, run, integration, settings
src/components/auth/auth-screen.tsx        MODIFY  two-column with demo loop
src/components/layout/{sidebar,footer}.tsx, app-shell.tsx  MODIFY
vitest.config.ts, package.json, bun.lock   MODIFY
python-server/agenttrace/server/serializers.py     MODIFY  _iso UTC
python-server/agenttrace/server/routes/timeline.py CREATE
python-server/agenttrace/server/routes/runs.py     MODIFY  /api/runs/recent
python-server/agenttrace/server/app.py             MODIFY  include timeline router
python-server/tests/test_timeline.py, test_recent_runs.py, test_iso.py   CREATE
python-server/tests_e2e/test_themes.py             CREATE
.github/workflows/ci.yml                           MODIFY  bun run test; e2e screenshot artifact
docs/screenshots/*.png, README.md                  MODIFY  (Task 14)
```

---

## Phase 1 — Theme foundation and run view

### Task 1: Vitest, theme tokens, fonts

**Files:**
- Create: `vitest.config.ts`, `src/app/themes.css`, `src/lib/contrast.ts`, `src/lib/__tests__/themes.test.ts`
- Modify: `package.json` (+ `bun.lock`), `src/app/globals.css`, `src/app/layout.tsx`, `src/lib/types.ts`, `src/components/sequence-diagram/participants.ts`, `.github/workflows/ci.yml` (ui job: `bun run test`)

**Interfaces:**
- Produces: every token from Global Constraints on `[data-theme="phosphore"|"cyanotype"|"studio"]`; `contrastRatio(hexA, hexB): number` in `@/lib/contrast`; `EVENT_COLORS[type] = { color: "var(--ev-…)", text: "var(--ev-…-text)", label }`; `KIND_COLOR[kind] = "var(--kind-…)"`; `bun run test` runs Vitest.

- [ ] **Step 1: Tooling**

```bash
export PATH=$HOME/.bun/bin:$PATH
bun add -d vitest
bun add @fontsource/instrument-sans @fontsource/martian-mono @fontsource/b612 @fontsource/b612-mono @fontsource/bricolage-grotesque @fontsource/dm-mono
bun remove geist
```
`package.json` scripts: add `"test": "vitest run"`.

`vitest.config.ts`:
```ts
import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
})
```

- [ ] **Step 2: Failing test — every theme defines every token and meets the contrast rules**

`src/lib/__tests__/themes.test.ts`:
```ts
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
```

Run: `bun run test` → FAIL (no `contrast.ts`, no `themes.css`).

- [ ] **Step 3: `src/lib/contrast.ts`**

```ts
/** WCAG 2.x relative luminance / contrast ratio for #rrggbb colours. */
function channel(c: number): number {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

export function luminance(hex: string): number {
  const h = hex.replace("#", "")
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
```

- [ ] **Step 4: `src/app/themes.css`**

One block per theme with the spec palettes (Studio corrections from Global Constraints). Kind tokens alias event tokens: `--kind-user: var(--ev-answer); --kind-orchestrator: var(--ev-result); --kind-llm: var(--ev-llm); --kind-tool: var(--ev-tool); --kind-subagent: var(--ev-handoff);`. Each block also sets `color-scheme: dark` (Phosphore, Cyanotype) or `light` (Studio). The three blocks:

```css
/* Three complete themes. Attribute selectors (not :root) so a subtree can
   carry its own theme, e.g. the Settings previews. */
[data-theme="phosphore"] {
  --surface-0: #0C151C; --surface-1: #101D25; --surface-2: #152631;
  --line: #22343E; --line-strong: #2E4A57;
  --ink: #D6E7EE; --ink-2: #8FB3BF; --ink-3: #5E7C88;
  --ev-handoff: #F5B83D; --ev-llm: #4FD1E8; --ev-tool: #A78BFA;
  --ev-result: #4ADE9C; --ev-answer: #F472B6; --ev-error: #FF6B6B;
  --ev-handoff-text: var(--ev-handoff); --ev-llm-text: var(--ev-llm); --ev-tool-text: var(--ev-tool);
  --ev-result-text: var(--ev-result); --ev-answer-text: var(--ev-answer); --ev-error-text: var(--ev-error);
  --st-running: #F5B83D; --st-ok: #4ADE9C; --st-failed: #FF6B6B;
  --kind-user: var(--ev-answer); --kind-orchestrator: var(--ev-result); --kind-llm: var(--ev-llm);
  --kind-tool: var(--ev-tool); --kind-subagent: var(--ev-handoff);
  --font-ui: "Instrument Sans", ui-sans-serif, system-ui, sans-serif;
  --font-data: "Martian Mono", ui-monospace, monospace;
  --radius-panel: 6px; --radius-control: 4px;
  --shadow-raised: none;
  --focus-ring: #4FD1E8;
  color-scheme: dark;
}
```
```css
[data-theme="cyanotype"] {
  --surface-0: #10335A; --surface-1: #0C2A4B; --surface-2: #143C68;
  --line: #3A5F88; --line-strong: #9DB7D6;
  --ink: #EAF2FF; --ink-2: #9DB7D6; --ink-3: #6F8DB0;
  --ev-handoff: #FFC56B; --ev-llm: #8FE3FF; --ev-tool: #C9B8FF;
  --ev-result: #9BF0C4; --ev-answer: #FF9FC8; --ev-error: #FF8A8A;
  --ev-handoff-text: var(--ev-handoff); --ev-llm-text: var(--ev-llm); --ev-tool-text: var(--ev-tool);
  --ev-result-text: var(--ev-result); --ev-answer-text: var(--ev-answer); --ev-error-text: var(--ev-error);
  --st-running: #FFC56B; --st-ok: #9BF0C4; --st-failed: #FF8A8A;
  --kind-user: var(--ev-answer); --kind-orchestrator: var(--ev-result); --kind-llm: var(--ev-llm);
  --kind-tool: var(--ev-tool); --kind-subagent: var(--ev-handoff);
  --font-ui: "B612", ui-sans-serif, system-ui, sans-serif;
  --font-data: "B612 Mono", ui-monospace, monospace;
  --radius-panel: 2px; --radius-control: 2px;
  --shadow-raised: none;
  --focus-ring: #8FE3FF;
  color-scheme: dark;
}

[data-theme="studio"] {
  --surface-0: #E3E6EA; --surface-1: #F5F6F8; --surface-2: #FFFFFF;
  --line: #C3C8D0; --line-strong: #A9B0BA;
  --ink: #1D2026; --ink-2: #5B6270; --ink-3: #7D8490;
  --ev-handoff: #E25200; --ev-llm: #2F6BFF; --ev-tool: #7A4DFF;
  --ev-result: #0C8F52; --ev-answer: #F0387F; --ev-error: #E5383B;
  --ev-handoff-text: #B84400; --ev-llm-text: #2457D6; --ev-tool-text: #6236E0;
  --ev-result-text: #0B7A47; --ev-answer-text: #C21E5F; --ev-error-text: #B3202A;
  --st-running: #E25200; --st-ok: #0C8F52; --st-failed: #E5383B;
  --kind-user: var(--ev-answer); --kind-orchestrator: var(--ev-result); --kind-llm: var(--ev-llm);
  --kind-tool: var(--ev-tool); --kind-subagent: var(--ev-handoff);
  --font-ui: "Bricolage Grotesque", ui-sans-serif, system-ui, sans-serif;
  --font-data: "DM Mono", ui-monospace, monospace;
  --radius-panel: 10px; --radius-control: 7px;
  --shadow-raised: 0 1px 2px rgb(11 18 32 / 0.12), 0 1px 1px rgb(11 18 32 / 0.06);
  --focus-ring: #2457D6;
  color-scheme: light;
}
```

Also in `themes.css`, the canvas backgrounds (used by the diagram in Task 3):
```css
.at-canvas { background: var(--surface-0); }
[data-theme="phosphore"] .at-canvas {
  background-image:
    linear-gradient(to right, color-mix(in oklab, var(--line) 55%, transparent) 1px, transparent 1px),
    linear-gradient(to bottom, color-mix(in oklab, var(--line) 55%, transparent) 1px, transparent 1px);
  background-size: 20px 20px;
}
[data-theme="cyanotype"] .at-canvas {
  background-image:
    linear-gradient(to right, rgb(234 242 255 / 0.05) 1px, transparent 1px),
    linear-gradient(to bottom, rgb(234 242 255 / 0.05) 1px, transparent 1px),
    linear-gradient(to right, rgb(234 242 255 / 0.11) 1px, transparent 1px),
    linear-gradient(to bottom, rgb(234 242 255 / 0.11) 1px, transparent 1px);
  background-size: 10px 10px, 10px 10px, 50px 50px, 50px 50px;
}
[data-theme="studio"] .at-canvas { background: var(--surface-1); }
```

- [ ] **Step 5: Wire tokens into the app**

`globals.css`:
- `@import "./themes.css";` after the Tailwind imports.
- Replace the old `:root { … }` and `.light { … }` palettes with aliases on `[data-theme]`:
```css
[data-theme] {
  --background: var(--surface-0); --foreground: var(--ink);
  --card: var(--surface-1); --card-foreground: var(--ink);
  --popover: var(--surface-2); --popover-foreground: var(--ink);
  --primary: var(--ev-result); --primary-foreground: var(--surface-0);
  --secondary: var(--surface-2); --secondary-foreground: var(--ink);
  --muted: var(--surface-2); --muted-foreground: var(--ink-2);
  --accent: var(--surface-2); --accent-foreground: var(--ink);
  --destructive: var(--ev-error); --destructive-foreground: var(--surface-0);
  --border: var(--line); --input: var(--line); --ring: var(--focus-ring);
  --sidebar: var(--surface-1); --sidebar-foreground: var(--ink); --sidebar-primary: var(--ev-result);
  --sidebar-primary-foreground: var(--surface-0); --sidebar-accent: var(--surface-2);
  --sidebar-accent-foreground: var(--ink); --sidebar-border: var(--line); --sidebar-ring: var(--focus-ring);
  --radius: var(--radius-panel);
}
```
- `@theme inline`: `--font-sans: var(--font-ui); --font-mono: var(--font-data);`.
- Dark variant follows the theme: `@custom-variant dark (&:is([data-theme="phosphore"] *, [data-theme="cyanotype"] *));`.
- Keep `.at-scroll`, `.at-pulse-ring`, `.at-blink`; delete `.at-graticule`, `.at-graticule-fine`, `.at-scanlines`, `.at-glow`, `.at-glow-amber`, `.at-radar-sweep`, `.at-trace-draw`, `.at-dot` only after replacing their uses (grep; the run view rewrite in Tasks 3–6 removes most — leave any still referenced and note them in the report).

`layout.tsx`: import the font CSS files (only the weights listed in Global Constraints), remove the `geist` imports and the `className` font variables; `<html lang="en" data-theme="cyanotype" suppressHydrationWarning>` (temporary static theme — Task 2 replaces it with the boot script); body `className="antialiased bg-background text-foreground min-h-screen font-sans"`.

`types.ts`: `EVENT_COLORS` becomes
```ts
export const EVENT_COLORS: Record<EventType, { color: string; text: string; label: string }> = {
  llm_call: { color: "var(--ev-llm)", text: "var(--ev-llm-text)", label: "LLM call" },
  tool_call: { color: "var(--ev-tool)", text: "var(--ev-tool-text)", label: "Tool call" },
  tool_result: { color: "var(--ev-result)", text: "var(--ev-result-text)", label: "Tool result" },
  handoff: { color: "var(--ev-handoff)", text: "var(--ev-handoff-text)", label: "Handoff" },
  error: { color: "var(--ev-error)", text: "var(--ev-error-text)", label: "Error" },
  final_answer: { color: "var(--ev-answer)", text: "var(--ev-answer-text)", label: "Final answer" },
}
```
`participants.ts`: `KIND_COLOR` values → `var(--kind-user)` etc. Fix every consumer that string-concatenated a hex alpha onto these colours (e.g. `` `${color}66` ``): use `color-mix(in oklab, ${color} 40%, transparent)` instead (grep `EVENT_COLORS`, `KIND_COLOR`, `meta.color`).

CI (`ci.yml`, ui job): add `- run: bun run test` after typecheck.

- [ ] **Step 6: Verify**

`bun run test` → PASS. `bun run lint && bun run typecheck && bun run build:ui` → clean. Manual: `agenttrace ui --auth none` from a temp dir after `agenttrace demo`, open it, temporarily switch `data-theme` in devtools to each theme — every screen stays readable (no hard-coded green leftovers in the chrome; the diagram is rewritten in Task 3).

- [ ] **Step 7: Commit**

```bash
git add -A src package.json bun.lock vitest.config.ts .github/workflows/ci.yml
git commit -m "feat(ui): three theme token sets, fonts, Vitest with contrast checks"
```

---

### Task 2: Theme selection, no-flash boot script, switcher, reveal transition

**Files:**
- Create: `src/lib/theme-core.ts` (pure, no "use client" — importable by the server layout), `src/lib/theme.ts` (client store), `src/lib/__tests__/theme.test.ts`, `src/components/theme/theme-switcher.tsx`, `src/components/theme/theme-sync.tsx`
- Modify: `src/app/layout.tsx`, `src/app/themes.css`, `src/components/providers.tsx`, `src/components/layout/sidebar.tsx`, `src/components/ui/sonner.tsx`

**Interfaces:**
- Consumes: Task 1 tokens.
- Produces (`@/lib/theme-core`, re-exported by `@/lib/theme`): `ThemeId`, `ThemePreference`, `THEME_IDS`, `THEME_LABELS`, `THEME_STORAGE_KEY`, `resolveTheme(pref, prefersDark): ThemeId`, `parsePreference(raw): ThemePreference`, `readStoredPreference(storage): ThemePreference`, `writeStoredPreference(storage, pref): void`, `THEME_BOOT_SCRIPT: string`. (`@/lib/theme`): `useTheme` zustand store `{ preference, resolved, setPreference(pref, origin?: {x: number; y: number}), syncFromDocument(), setSystemDark(dark: boolean) }`, `applyTheme(next: ThemeId, origin?)`.
- `<ThemeSwitcher compact?: boolean />` (sidebar), `<ThemeSync />` (mounted once in Providers).

- [ ] **Step 1: Failing tests**

`src/lib/__tests__/theme.test.ts`:
```ts
import { describe, expect, it } from "vitest"
import { parsePreference, readStoredPreference, resolveTheme, writeStoredPreference, THEME_STORAGE_KEY } from "@/lib/theme-core"

describe("resolveTheme", () => {
  it("auto follows the OS", () => {
    expect(resolveTheme("auto", true)).toBe("cyanotype")
    expect(resolveTheme("auto", false)).toBe("studio")
  })
  it("explicit choice wins", () => {
    expect(resolveTheme("phosphore", false)).toBe("phosphore")
    expect(resolveTheme("studio", true)).toBe("studio")
  })
})

describe("stored preference", () => {
  const memory = () => {
    const m = new Map<string, string>()
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
  }
  const throwing = {
    getItem: () => { throw new Error("SecurityError") },
    setItem: () => { throw new Error("QuotaExceeded") },
  }
  it("round-trips a valid preference", () => {
    const s = memory()
    writeStoredPreference(s, "phosphore")
    expect(readStoredPreference(s)).toBe("phosphore")
  })
  it("ignores garbage", () => {
    const s = memory()
    s.setItem(THEME_STORAGE_KEY, "neon")
    expect(readStoredPreference(s)).toBe("auto")
    expect(parsePreference(null)).toBe("auto")
  })
  it("survives storage that throws", () => {
    expect(readStoredPreference(throwing)).toBe("auto")
    expect(() => writeStoredPreference(throwing, "studio")).not.toThrow()
    expect(readStoredPreference(null)).toBe("auto")
  })
})
```
Run `bun run test` → FAIL (module missing).

- [ ] **Step 2: `src/lib/theme-core.ts` and `src/lib/theme.ts`**

`theme-core.ts` holds everything from `export type ThemeId` down to `THEME_BOOT_SCRIPT` (no `"use client"`, no zustand); `theme.ts` starts with `"use client"`, `export * from "./theme-core"`, imports what it needs from it, and holds `safeStorage`, `applyTheme` and the store. Written as one listing for readability:

```ts
"use client"

import { create } from "zustand"

export type ThemeId = "phosphore" | "cyanotype" | "studio"
export type ThemePreference = ThemeId | "auto"
export const THEME_IDS: ThemeId[] = ["phosphore", "cyanotype", "studio"]
export const THEME_LABELS: Record<ThemeId, string> = { phosphore: "Phosphore", cyanotype: "Cyanotype", studio: "Studio" }
export const THEME_STORAGE_KEY = "agenttrace-theme"

type ReadStorage = Pick<Storage, "getItem"> | null | undefined
type WriteStorage = Pick<Storage, "setItem"> | null | undefined

export function resolveTheme(pref: ThemePreference, prefersDark: boolean): ThemeId {
  if (pref === "auto") return prefersDark ? "cyanotype" : "studio"
  return pref
}

export function parsePreference(raw: unknown): ThemePreference {
  return raw === "auto" || THEME_IDS.includes(raw as ThemeId) ? (raw as ThemePreference) : "auto"
}

export function readStoredPreference(storage: ReadStorage): ThemePreference {
  try {
    return parsePreference(storage?.getItem(THEME_STORAGE_KEY))
  } catch {
    return "auto"
  }
}

export function writeStoredPreference(storage: WriteStorage, pref: ThemePreference): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, pref)
  } catch {
    // private mode / blocked storage: the choice lasts for this session only
  }
}

/** Runs in <head> before first paint (keep in sync with resolveTheme). */
export const THEME_BOOT_SCRIPT = `(function(){var p=null;try{p=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)})}catch(e){}var ids=${JSON.stringify(THEME_IDS)};var dark=!!(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches);var pref=ids.indexOf(p)>=0?p:"auto";var t=pref==="auto"?(dark?"cyanotype":"studio"):pref;var r=document.documentElement;r.setAttribute("data-theme",t);r.setAttribute("data-theme-pref",pref)})()`

function safeStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function applyTheme(next: ThemeId, origin?: { x: number; y: number }): void {
  const root = document.documentElement
  if (root.getAttribute("data-theme") === next) return
  const commit = () => root.setAttribute("data-theme", next)
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown }
  if (reduce) return commit()
  if (doc.startViewTransition) {
    root.style.setProperty("--vt-x", origin ? `${origin.x}px` : "50%")
    root.style.setProperty("--vt-y", origin ? `${origin.y}px` : "50%")
    doc.startViewTransition(commit)
    return
  }
  root.setAttribute("data-theme-switching", "")
  commit()
  window.setTimeout(() => root.removeAttribute("data-theme-switching"), 220)
}

interface ThemeState {
  preference: ThemePreference
  resolved: ThemeId
  systemDark: boolean
  setPreference: (pref: ThemePreference, origin?: { x: number; y: number }) => void
  syncFromDocument: () => void
  setSystemDark: (dark: boolean) => void
}

export const useTheme = create<ThemeState>((set, get) => ({
  preference: "auto",
  resolved: "cyanotype",
  systemDark: true,
  setPreference: (preference, origin) => {
    const resolved = resolveTheme(preference, get().systemDark)
    writeStoredPreference(safeStorage(), preference)
    document.documentElement.setAttribute("data-theme-pref", preference)
    applyTheme(resolved, origin)
    set({ preference, resolved })
  },
  syncFromDocument: () => {
    const root = document.documentElement
    const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches
    const preference = parsePreference(root.getAttribute("data-theme-pref"))
    set({ preference, systemDark, resolved: resolveTheme(preference, systemDark) })
  },
  setSystemDark: (systemDark) => {
    const { preference } = get()
    const resolved = resolveTheme(preference, systemDark)
    set({ systemDark, resolved })
    if (preference === "auto") applyTheme(resolved)
  },
}))
```

`src/components/theme/theme-sync.tsx`:
```tsx
"use client"

import { useEffect } from "react"
import { useTheme } from "@/lib/theme"

/** Hydrates the theme store from the attributes the boot script set, and
 * follows OS light/dark changes while the preference is "auto". */
export function ThemeSync() {
  useEffect(() => {
    useTheme.getState().syncFromDocument()
    const mql = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => useTheme.getState().setSystemDark(mql.matches)
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [])
  return null
}
```

- [ ] **Step 3: Boot script, transition CSS, switcher**

`layout.tsx`: remove the static `data-theme`; inside `<html>` render
```tsx
<head>
  <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
</head>
```
(The layout is a server component: import `THEME_BOOT_SCRIPT` from `@/lib/theme-core`, never from the client module.)

`themes.css` additions:
```css
::view-transition-old(root),
::view-transition-new(root) { animation: none; mix-blend-mode: normal; }
::view-transition-new(root) { animation: at-theme-reveal 450ms cubic-bezier(0.2, 0.7, 0.2, 1); }
@keyframes at-theme-reveal {
  from { clip-path: circle(0 at var(--vt-x, 50%) var(--vt-y, 50%)); }
  to { clip-path: circle(150vmax at var(--vt-x, 50%) var(--vt-y, 50%)); }
}
[data-theme-switching] *, [data-theme-switching] *::before, [data-theme-switching] *::after {
  transition: background-color 200ms, color 200ms, border-color 200ms, fill 200ms, stroke 200ms !important;
}
```

`theme-switcher.tsx`: a row of four buttons — Auto (icon `Monitor` from lucide) and one swatch per theme (a 20×20 rounded square split into the theme's `--surface-0`, `--ev-result`, `--ev-handoff`; render each swatch inside `<span data-theme={id}>` so it reads that theme's tokens). Each button: `aria-pressed`, `title` (`Auto (follows your system)`, `Phosphore`, …), `onClick={(e) => setPreference(id, { x: e.clientX, y: e.clientY })}`. `compact` (collapsed sidebar rail): vertical stack. Mount it at the bottom of `sidebar.tsx` (both expanded and collapsed variants) above the account block.

`providers.tsx`: render `<ThemeSync />`; Toaster `theme={resolved === "studio" ? "light" : "dark"}` from `useTheme`.

- [ ] **Step 4: Verify**

`bun run test` (theme tests PASS), lint, typecheck, `build:ui`. Manual (dev or bundle): switch each theme from the sidebar → circle reveal from the click point; reload → same theme, no flash; set Auto and toggle the OS/devtools colour scheme → Studio/Cyanotype follow live; devtools "Emulate prefers-reduced-motion" → instant switch.

- [ ] **Step 5: Commit**

```bash
git add -A src
git commit -m "feat(ui): theme selection with auto mode, no-flash boot script and reveal transition"
```

---

### Task 3: Themed diagram renderer — geometry, styles, static rendering

**Files:**
- Create: `src/lib/diagram-styles.ts`, `src/components/sequence-diagram/geometry.ts`, `src/components/sequence-diagram/__tests__/geometry.test.ts`, `src/components/sequence-diagram/themed-diagram.tsx`, `src/components/sequence-diagram/arrow.tsx`, `src/components/sequence-diagram/lane-headers.tsx`, `src/components/sequence-diagram/decorations.tsx`
- Modify: `src/components/sequence-diagram/sequence-diagram.tsx` (use `ThemedDiagram`), delete `lifeline-diagram.tsx` once unused

**Interfaces:**
- Consumes: `useTheme().resolved` (Task 2), tokens (Task 1), `extractParticipants` (existing).
- Produces:
  - `DIAGRAM_STYLES: Record<ThemeId, DiagramStyle>` and the `DiagramStyle` type exactly as in the spec (`header`, `lifeline`, `arrow`, `arrival`, `afterglow`, `duration`, `decorations`, `timing`).
  - `LAYOUT = { laneWidth: 160, headerHeight: 64, rowHeight: 52, leftGutter: 84, rightPad: 32, bottomPad: 48 }`
  - `computeGeometry(events, participants, layout = LAYOUT): DiagramGeometry` with `DiagramGeometry = { width; height; lanes: { name: string; kind: Participant["kind"]; x: number }[]; arrows: ArrowGeom[] }` and `ArrowGeom = { id; index; x1; x2; y; forward; selfLoop; isReturn; isError; label; title; type; durationMs; status }` (`label` truncated to fit the arrow, `title` = full text).
  - `truncate(text, maxChars)`; `laneLabel(name)` (≤ 16 chars + "…").
  - `<ThemedDiagram events participants selectedId onSelect live style run={{ name, project, status, startedAt, endedAt }} />` — `style` defaults to `DIAGRAM_STYLES[useTheme().resolved]` (a prop so the demo loop can force a theme).

- [ ] **Step 1: Styles (verbatim from the spec table)**

```ts
// src/lib/diagram-styles.ts
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
```

- [ ] **Step 2: Failing geometry tests**

`src/components/sequence-diagram/__tests__/geometry.test.ts`:
```ts
import { describe, expect, it } from "vitest"
import { computeGeometry, LAYOUT, laneLabel, truncate } from "../geometry"
import type { Participant, TraceEvent } from "@/lib/types"

const ev = (i: number, source: string, target: string, type: TraceEvent["type"], extra: Partial<TraceEvent> = {}): TraceEvent => ({
  id: `e${i}`, runId: "r", seq: i, timestamp: new Date(1_700_000_000_000 + i * 1000).toISOString(),
  source, target, type, label: `${type} ${i}`, payload: {}, durationMs: null, status: "ok", ...extra,
})
const P = (name: string, kind: Participant["kind"] = "tool"): Participant => ({ id: name, name, kind, icon: kind })

describe("computeGeometry", () => {
  const parts = [P("User", "user"), P("Orchestrator", "orchestrator"), P("web_search")]
  const events = [
    ev(0, "User", "Orchestrator", "handoff"),
    ev(1, "Orchestrator", "web_search", "tool_call"),
    ev(2, "web_search", "Orchestrator", "tool_result", { durationMs: 1500 }),
    ev(3, "web_search", "Orchestrator", "error", { status: "error" }),
    ev(4, "Orchestrator", "Orchestrator", "llm_call"),
  ]
  const g = computeGeometry(events, parts)

  it("places lanes on the lane grid", () => {
    expect(g.lanes.map((l) => l.x)).toEqual([0, 1, 2].map((i) => LAYOUT.leftGutter + i * LAYOUT.laneWidth + LAYOUT.laneWidth / 2))
    expect(g.width).toBe(LAYOUT.leftGutter + 3 * LAYOUT.laneWidth + LAYOUT.rightPad)
  })
  it("one row per event, below the header", () => {
    expect(g.arrows.map((a) => a.y)).toEqual(events.map((_, i) => LAYOUT.headerHeight + i * LAYOUT.rowHeight + LAYOUT.rowHeight / 2))
    expect(g.height).toBe(LAYOUT.headerHeight + events.length * LAYOUT.rowHeight + LAYOUT.bottomPad)
  })
  it("direction, return, error and self loops", () => {
    expect(g.arrows[1].forward).toBe(true)
    expect(g.arrows[2].forward).toBe(false)
    expect(g.arrows[2].isReturn).toBe(true)
    expect(g.arrows[1].isReturn).toBe(false)
    expect(g.arrows[3].isError).toBe(true)
    expect(g.arrows[4].selfLoop).toBe(true)
  })
  it("unknown participants fall back to the first lane", () => {
    const g2 = computeGeometry([ev(0, "Ghost", "User", "handoff")], parts)
    expect(g2.arrows[0].x1).toBe(g.lanes[0].x)
  })
  it("empty run still has a drawable height", () => {
    expect(computeGeometry([], parts).height).toBe(LAYOUT.headerHeight + LAYOUT.rowHeight + LAYOUT.bottomPad)
  })
  it("labels fit the arrow; full text kept as title", () => {
    const long = ev(0, "User", "Orchestrator", "handoff", { label: "x".repeat(80) })
    const a = computeGeometry([long], parts).arrows[0]
    expect(a.label.length).toBeLessThan(80)
    expect(a.label.endsWith("…")).toBe(true)
    expect(a.title).toBe("x".repeat(80))
  })
})

describe("text helpers", () => {
  it("truncate", () => {
    expect(truncate("hello", 10)).toBe("hello")
    expect(truncate("hello world", 6)).toBe("hello…")
  })
  it("laneLabel caps long participant names", () => {
    expect(laneLabel("a_very_long_tool_name_for_testing")).toBe("a_very_long_tool…")
    expect(laneLabel("LLM")).toBe("LLM")
  })
})
```
Run → FAIL.

- [ ] **Step 3: `geometry.ts`**

```ts
import type { Participant, TraceEvent } from "@/lib/types"

export const LAYOUT = { laneWidth: 160, headerHeight: 64, rowHeight: 52, leftGutter: 84, rightPad: 32, bottomPad: 48 }
export type Layout = typeof LAYOUT
const CHAR_W = 6.2 // ≈ width of one 11 px UI glyph; labels are truncated by count, not measured

export interface ArrowGeom {
  id: string; index: number; x1: number; x2: number; y: number
  forward: boolean; selfLoop: boolean; isReturn: boolean; isError: boolean
  label: string; title: string; type: TraceEvent["type"]; durationMs: number | null; status: TraceEvent["status"]
}
export interface DiagramGeometry {
  width: number; height: number
  lanes: { name: string; kind: Participant["kind"]; x: number }[]
  arrows: ArrowGeom[]
}

export function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? text.slice(0, Math.max(1, maxChars - 1)) + "…" : text
}

export function laneLabel(name: string): string {
  return truncate(name, 17)
}

export function computeGeometry(events: TraceEvent[], participants: Participant[], layout: Layout = LAYOUT): DiagramGeometry {
  const laneX = (i: number) => layout.leftGutter + i * layout.laneWidth + layout.laneWidth / 2
  const index = new Map(participants.map((p, i) => [p.name, i]))
  const xOf = (name: string) => laneX(index.get(name) ?? 0)
  const lanes = participants.map((p, i) => ({ name: p.name, kind: p.kind, x: laneX(i) }))
  const arrows = events.map((ev, i): ArrowGeom => {
    const x1 = xOf(ev.source)
    const x2 = xOf(ev.target)
    const selfLoop = ev.source === ev.target
    const span = selfLoop ? layout.laneWidth * 0.8 : Math.abs(x2 - x1)
    const full = ev.label || ev.type.replace("_", " ")
    return {
      id: ev.id, index: i, x1, x2, y: layout.headerHeight + i * layout.rowHeight + layout.rowHeight / 2,
      forward: x2 >= x1, selfLoop, isReturn: ev.type === "tool_result",
      isError: ev.type === "error" || ev.status === "error",
      label: truncate(full, Math.max(12, Math.floor(span / CHAR_W))), title: full,
      type: ev.type, durationMs: ev.durationMs ?? null, status: ev.status,
    }
  })
  return {
    width: layout.leftGutter + participants.length * layout.laneWidth + layout.rightPad,
    height: layout.headerHeight + Math.max(1, events.length) * layout.rowHeight + layout.bottomPad,
    lanes,
    arrows,
  }
}
```

- [ ] **Step 4: Renderer (static, no arrival animation yet — Task 4 adds it)**

Requirements for `ThemedDiagram` and its parts (implement with the tokens; every colour is a CSS variable, every font `var(--font-ui)`/`var(--font-data)`):
- Container `div.at-canvas.relative.h-full.overflow-auto.at-scroll` (`data-testid="diagram"`, `data-theme-style={style.theme}`); inside, `LaneHeaders` (sticky `top-0 z-10`, its own `<svg width={geometry.width} height={LAYOUT.headerHeight}>`) then the body `<svg width height={geometry.height - LAYOUT.headerHeight}>` translated so body coordinates match `ArrowGeom.y - headerHeight`.
- `LaneHeaders` by `style.header`: `box` (rounded rect `--surface-2`, stroke kind colour at 40 %, name in data font 11 px), `titled` (square rect `--surface-0` with `--ink` stroke and a thin inner rule, data font), `tile` (white `--surface-2` rounded 7 px with `--shadow-raised` via `filter: drop-shadow` CSS, LED circle left of the name, UI font semibold). Names through `laneLabel`, full name in `<title>`.
- Lifelines: vertical lines from header bottom to `height - bottomPad`, `stroke="var(--line-strong)"`, `strokeDasharray={style.lifeline.dash || undefined}`, `strokeWidth={style.lifeline.width}`.
- Left gutter: event clock time `HH:MM:SS.cc` in data font 9 px `--ink-3` (use `toLocaleTimeString` parts; the backend now sends explicit UTC — Task 7).
- `Arrow` per `ArrowGeom`: line (`strokeWidth={style.arrow.width}`, `strokeDasharray={a.isReturn ? style.arrow.returnDash : undefined}`), self loops as a cubic path to the right; head `filled` (triangle) or `open` (polyline) at `x2`; error → small cross (two 5 px lines) at the head in `--ev-error`; colour `EVENT_COLORS[type].color` (error status overrides with `--ev-error`); label above (UI font 11 px `--ink`, `<title>` with the full text); duration by `style.duration`: `label` (data font 9 px under the arrow in the event text colour), `dimension` (thin line 10 px under the arrow with 45° ticks at both ends and the value centred on a `--surface-0` knockout), `chip` (rounded pill, event colour at 12 % fill, text colour); selection highlight = rounded rect, event colour 10 % fill / 50 % stroke; transparent hit area 36 px tall; `onClick` → `onSelect(id)`; `role="button"`, `aria-label={`${type} ${source} to ${target}: ${title}`}`, `tabIndex={-1}` (keyboard handled at the container in Task 5).
- Decorations: `vignette` (absolute inset overlay `pointer-events-none` with a radial gradient to `--surface-0`), `titleBlock` (HTML, `sticky bottom-3` aligned right inside the scroll container: bordered box in data font with run name, project, status, duration, event count — two rows split by hairlines, like a drawing's title block), `leds` (handled inside `tile` headers: LED colour = `--ink-3` at rest; Task 4 lights it).
- Live cursor (when `live`): hairline across the bottom at `--st-running` 50 % + the text "Waiting for the next event" (UI font 10 px, `--ink-2`). No moving dot (the old `cx` animation is gone).

Replace `LifelineDiagram` with `ThemedDiagram` in `sequence-diagram.tsx` (pass `run` meta from new props `runName`, `projectName`, `startedAt`, `endedAt` — RunView passes them), then `git rm src/components/sequence-diagram/lifeline-diagram.tsx`. Remove the now-unused `.at-graticule`/`.at-scanlines` uses in `ListeningState` (use `.at-canvas`).

- [ ] **Step 5: Verify**

`bun run test` (geometry PASS), lint, typecheck, `build:ui`. Manual: open a demo run in each theme — headers, lifelines, heads, dashed returns, error crosses, duration variants and the Cyanotype title block render; no console errors (the `cx` error is gone).

- [ ] **Step 6: Commit**

```bash
git add -A src
git commit -m "feat(ui): themed diagram renderer with per-theme headers, arrows and decorations"
```

---

### Task 4: Arrival animations, cascade, reduced motion, activation bars, virtualisation

**Files:**
- Create: `src/components/sequence-diagram/arrivals.ts`, `activation.ts`, `virtual-window.ts` + `__tests__/arrivals.test.ts`, `__tests__/activation.test.ts`, `__tests__/virtual-window.test.ts`
- Modify: `themed-diagram.tsx`, `arrow.tsx`, `lane-headers.tsx`

**Interfaces:**
- Consumes: Task 3 renderer and `DiagramStyle`.
- Produces:
  - `classifyArrivals(seen: ReadonlySet<string> | null, ids: string[], cascadeCap = 40): { cascade: string[]; arrivals: string[] }` — `seen = null` means first render (first `cascadeCap` ids cascade, the rest appear instantly); otherwise ids not in `seen` are arrivals.
  - `computeActivations(events): { lane: string; fromIndex: number; toIndex: number | null }[]`
  - `VIRTUALIZE_THRESHOLD = 200`, `OVERSCAN = 20`, `visibleRange(total, scrollTop, viewportHeight, rowHeight, headerHeight, overscan = OVERSCAN): { start: number; end: number }` (end exclusive)
  - Arrow elements carry `data-arrival="pulse" | "pen" | "spring" | "fade"` while their arrival animation runs (removed when settled) — the e2e tests rely on it.

- [ ] **Step 1: Failing tests**

`__tests__/arrivals.test.ts`:
```ts
import { describe, expect, it } from "vitest"
import { classifyArrivals } from "../arrivals"

describe("classifyArrivals", () => {
  const ids = Array.from({ length: 50 }, (_, i) => `e${i}`)
  it("first render: first 40 cascade, the rest are instant", () => {
    const r = classifyArrivals(null, ids)
    expect(r.cascade).toEqual(ids.slice(0, 40))
    expect(r.arrivals).toEqual([])
  })
  it("later renders: only unseen ids arrive", () => {
    const r = classifyArrivals(new Set(ids.slice(0, 48)), ids)
    expect(r.cascade).toEqual([])
    expect(r.arrivals).toEqual(["e48", "e49"])
  })
  it("respects a custom cascade cap", () => {
    expect(classifyArrivals(null, ids.slice(0, 5), 3).cascade).toEqual(["e0", "e1", "e2"])
  })
})
```

`__tests__/activation.test.ts`:
```ts
import { describe, expect, it } from "vitest"
import { computeActivations } from "../activation"
import type { TraceEvent } from "@/lib/types"

const ev = (i: number, source: string, target: string, type: TraceEvent["type"]): TraceEvent => ({
  id: `e${i}`, runId: "r", seq: i, timestamp: "2026-10-03T12:00:00+00:00", source, target, type,
  label: null, payload: {}, durationMs: null, status: "ok",
})

describe("computeActivations", () => {
  it("pairs each call with the next result from the same tool", () => {
    const events = [
      ev(0, "Orch", "search", "tool_call"),
      ev(1, "Orch", "calc", "tool_call"),
      ev(2, "calc", "Orch", "tool_result"),
      ev(3, "search", "Orch", "tool_result"),
    ]
    expect(computeActivations(events)).toEqual([
      { lane: "search", fromIndex: 0, toIndex: 3 },
      { lane: "calc", fromIndex: 1, toIndex: 2 },
    ])
  })
  it("an error from the tool also closes its bar", () => {
    const events = [ev(0, "Orch", "search", "tool_call"), ev(1, "search", "Orch", "error")]
    expect(computeActivations(events)).toEqual([{ lane: "search", fromIndex: 0, toIndex: 1 }])
  })
  it("unmatched calls stay open (null end)", () => {
    expect(computeActivations([ev(0, "Orch", "search", "tool_call")])).toEqual([{ lane: "search", fromIndex: 0, toIndex: null }])
  })
  it("results without a call are ignored", () => {
    expect(computeActivations([ev(0, "search", "Orch", "tool_result")])).toEqual([])
  })
})
```

`__tests__/virtual-window.test.ts`:
```ts
import { describe, expect, it } from "vitest"
import { OVERSCAN, VIRTUALIZE_THRESHOLD, visibleRange } from "../virtual-window"

describe("visibleRange", () => {
  it("renders everything at or below the threshold", () => {
    expect(visibleRange(VIRTUALIZE_THRESHOLD, 5000, 600, 52, 64)).toEqual({ start: 0, end: VIRTUALIZE_THRESHOLD })
  })
  it("windows around the viewport with overscan", () => {
    const r = visibleRange(1000, 64 + 100 * 52, 520, 52, 64)
    expect(r.start).toBe(100 - OVERSCAN)
    expect(r.end).toBe(100 + 11 + OVERSCAN)
  })
  it("clamps at both ends", () => {
    expect(visibleRange(1000, 0, 520, 52, 64).start).toBe(0)
    expect(visibleRange(1000, 10_000_000, 520, 52, 64).end).toBe(1000)
  })
})
```
Run → FAIL.

- [ ] **Step 2: Pure modules**

```ts
// arrivals.ts
export function classifyArrivals(seen: ReadonlySet<string> | null, ids: string[], cascadeCap = 40) {
  if (seen === null) return { cascade: ids.slice(0, cascadeCap), arrivals: [] as string[] }
  return { cascade: [] as string[], arrivals: ids.filter((id) => !seen.has(id)) }
}
```
```ts
// activation.ts
import type { TraceEvent } from "@/lib/types"

export interface ActivationBar { lane: string; fromIndex: number; toIndex: number | null }

/** A tool_call to X opens a bar on X's lifeline; the next tool_result (or
 * error) whose source is X closes the oldest open bar on X. */
export function computeActivations(events: TraceEvent[]): ActivationBar[] {
  const open = new Map<string, number[]>()
  const bars: ActivationBar[] = []
  events.forEach((ev, i) => {
    if (ev.type === "tool_call") {
      open.set(ev.target, [...(open.get(ev.target) ?? []), i])
    } else if (ev.type === "tool_result" || ev.type === "error") {
      const queue = open.get(ev.source)
      if (queue?.length) bars.push({ lane: ev.source, fromIndex: queue.shift()!, toIndex: i })
    }
  })
  for (const [lane, queue] of open) for (const fromIndex of queue) bars.push({ lane, fromIndex, toIndex: null })
  return bars.sort((a, b) => a.fromIndex - b.fromIndex)
}
```
```ts
// virtual-window.ts
export const VIRTUALIZE_THRESHOLD = 200
export const OVERSCAN = 20

export function visibleRange(total: number, scrollTop: number, viewportHeight: number, rowHeight: number,
  headerHeight: number, overscan = OVERSCAN): { start: number; end: number } {
  if (total <= VIRTUALIZE_THRESHOLD) return { start: 0, end: total }
  const first = Math.floor(Math.max(0, scrollTop - headerHeight) / rowHeight)
  const count = Math.ceil(viewportHeight / rowHeight) + 1
  return { start: Math.max(0, first - overscan), end: Math.min(total, first + count + overscan) }
}
```
Note: the activation rule extends the spec with "error closes the bar" (a failing tool stops working); record it in the report.

- [ ] **Step 3: Animations in the renderer (framer-motion, transforms only)**

- `ThemedDiagram` keeps `seenRef = useRef<Set<string> | null>(null)`. First render: `classifyArrivals(null, idsOfTheInitialVisibleWindow)` (so the cascade plays on the rows the user actually sees, e.g. the bottom of a long live run); later renders: `classifyArrivals(seenRef.current, allIds)` — over **all** ids, not just the window, so scrolling never replays old events. After each render (effect) add every id to the set. Cascade: event `i` of the cascade gets delay `i * (style.timing.cascadeMs / cascade.length)` and a 160 ms fade+draw. Arrivals get the theme animation:
  - **pulse**: line `pathLength 0→1` over `drawMs` (easeOut); a `motion.g` holding a 2.6 px `--ink` circle with a CSS `filter: drop-shadow(0 0 4px var(--ev-…))` translates `x: 0 → (x2 - x1)` over `drawMs`, then fades; ripple circle at the target `scale 0.1→1, opacity 0.9→0` over 700 ms after `drawMs`; afterglow: line `opacity 1 → 0.55` over `settleMs` after `drawMs` (then stays at 0.55 unless selected).
  - **pen**: line `pathLength` with `ease: [0.4, 0, 0.6, 1]` over `drawMs`; a nib group (circle r 2.8 + crosshair, `--ink`) translates with the tip, hidden after; head/label/duration fade in after `drawMs` (+150 ms for the dimension line).
  - **spring**: line `scaleX 0→1` with `transformOrigin` at the source end and `transition={{ type: "spring", stiffness: 380, damping: 26 }}`; head pops (`scale 0→1`); the target tile's LED (Task 3 `leds`) turns the event colour with a glow for `settleMs`, then rests at `--ink-3`.
  - Set `data-arrival` on the arrow `<g>` during the animation (`onAnimationComplete` clears it).
- Replay passes `speed` (0.5 | 1 | 2); arrival durations divide by it; `speed = 0` (instant) → no animation.
- `useReducedMotion()` (framer-motion) → every arrival/cascade becomes a 120 ms opacity fade (`data-arrival="fade"`), no travelling elements, no ripple, no spring.
- Activation bars: `computeActivations(allEvents)`; for each bar draw a 6 px wide rect centred on the lane, from the `fromIndex` row to the `toIndex` row (or the live cursor when `null`), event-tool colour at 18 % fill / 50 % stroke, under the arrows.
- Virtualisation: track `scrollTop`/`clientHeight` of the scroll container (passive scroll listener + `ResizeObserver`); render only arrows/time labels with `index ∈ [start, end)` and bars intersecting that window; lifelines and SVG height stay full.

- [ ] **Step 4: Verify**

`bun run test` PASS; lint, typecheck, `build:ui`. Manual with the demo agent script (see the bundled-ui demo: a run that logs an event every ~2 s): each theme shows its arrival; devtools reduced motion → fades only; a 1 000-event run (generate with `AgentTraceClient` in a loop into a temp SQLite DB, `agenttrace ui --database-url …`) opens fast and scrolls smoothly (Performance panel: no long frames while scrolling).

- [ ] **Step 5: Commit**

```bash
git add -A src
git commit -m "feat(ui): per-theme arrival motion, cascade, reduced motion, activation bars, virtualisation"
```

---

### Task 5: Run view — header, filters, search, keyboard, focus layout

**Files:**
- Create: `src/lib/run-filters.ts`, `src/lib/__tests__/run-filters.test.ts`, `src/components/sequence-diagram/selection.ts`, `src/components/sequence-diagram/__tests__/selection.test.ts`, `src/components/sequence-diagram/filter-bar.tsx`
- Modify: `src/components/views/run-view.tsx`, `src/components/sequence-diagram/sequence-diagram.tsx`, `src/components/app-shell.tsx`, `src/components/layout/sidebar.tsx`

**Interfaces:**
- Produces:
  - `filterEvents(events, hidden: ReadonlySet<EventType>, query: string): { visible: TraceEvent[]; matches: Set<string> }` (`query` matched case-insensitively against `label`, `source`, `target`, `type`; empty query → `matches` empty).
  - `nextSelection(ids: string[], current: string | null, key: "ArrowUp" | "ArrowDown" | "Home" | "End" | "Escape"): string | null`
  - `SequenceDiagram` new props: `runName`, `projectName`, `startedAt`, `endedAt`, `onStats?: (s: { count: number; lastTimestamp: string | null }) => void`.

- [ ] **Step 1: Failing tests**

```ts
// src/lib/__tests__/run-filters.test.ts
import { describe, expect, it } from "vitest"
import { filterEvents } from "@/lib/run-filters"
import type { TraceEvent } from "@/lib/types"

const ev = (i: number, type: TraceEvent["type"], label: string): TraceEvent => ({
  id: `e${i}`, runId: "r", seq: i, timestamp: "2026-10-03T12:00:00+00:00", source: "Orch", target: "web_search",
  type, label, payload: {}, durationMs: null, status: "ok",
})
const events = [ev(0, "llm_call", "classify intent"), ev(1, "tool_call", "web_search(rust)"), ev(2, "error", "timeout")]

describe("filterEvents", () => {
  it("hides filtered types, keeps order", () => {
    expect(filterEvents(events, new Set(["error"]), "").visible.map((e) => e.id)).toEqual(["e0", "e1"])
  })
  it("search highlights without removing", () => {
    const r = filterEvents(events, new Set(), "RUST")
    expect(r.visible).toHaveLength(3)
    expect([...r.matches]).toEqual(["e1"])
  })
  it("search also matches participants and type", () => {
    expect(filterEvents(events, new Set(), "llm").matches.has("e0")).toBe(true)
    expect(filterEvents(events, new Set(), "web_search").matches.size).toBe(3)
  })
  it("empty query matches nothing", () => {
    expect(filterEvents(events, new Set(), "  ").matches.size).toBe(0)
  })
})
```
```ts
// src/components/sequence-diagram/__tests__/selection.test.ts
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
```
Run → FAIL.

- [ ] **Step 2: Implement the pure modules**

```ts
// src/lib/run-filters.ts
import type { EventType, TraceEvent } from "@/lib/types"

export function filterEvents(events: TraceEvent[], hidden: ReadonlySet<EventType>, query: string) {
  const visible = events.filter((e) => !hidden.has(e.type))
  const q = query.trim().toLowerCase()
  const matches = new Set<string>()
  if (q) {
    for (const e of visible) {
      const hay = [e.label ?? "", e.source, e.target, e.type].join(" ").toLowerCase()
      if (hay.includes(q)) matches.add(e.id)
    }
  }
  return { visible, matches }
}
```
```ts
// selection.ts
export type SelectionKey = "ArrowUp" | "ArrowDown" | "Home" | "End" | "Escape"

export function nextSelection(ids: string[], current: string | null, key: SelectionKey): string | null {
  if (key === "Escape" || ids.length === 0) return null
  if (key === "Home") return ids[0]
  if (key === "End") return ids[ids.length - 1]
  const i = current === null ? -1 : ids.indexOf(current)
  if (i === -1) return key === "ArrowDown" ? ids[0] : ids[ids.length - 1]
  return ids[Math.max(0, Math.min(ids.length - 1, key === "ArrowDown" ? i + 1 : i - 1))]
}
```

- [ ] **Step 3: UI**

- `FilterBar` (replaces the old toolbar row; its right end shows the live connection state while the run is running: "Listening" with the running pulse, or "Reconnecting…"): one toggle chip per event type (dot + label from `EVENT_COLORS`, `aria-pressed`, hidden state = 30 % opacity dot and `--ink-3` text), and a search input (placeholder "Search events", `aria-label`). State lives in `SequenceDiagram` (`hidden: Set<EventType>`, `query`), persisted per session only.
- `SequenceDiagram`: `filterEvents(visibleEvents, hidden, query)` feeds the diagram; matched arrows get a highlight ring, non-matching arrows `opacity 0.35` while a query is active. The scroll container is focusable (`tabIndex=0`, `aria-label="Sequence diagram"`); `onKeyDown` maps the five keys through `nextSelection` over the **visible** ids, prevents default, and scrolls the selected row into view (`scrollTop` to centre `ArrowGeom.y`).
- Header (`RunView`): breadcrumb button (project), run name, status badge (`--st-*`, pulsing ring while running), and on the right `{count} events` + duration — **count from `onStats`** (the diagram's merged list), duration from `startedAt` to `endedAt` or to the latest event while running. Replace the old legend (the filter bar now carries it). Close/Delete actions unchanged.
- Focus layout: in `AppShell`, `const runFocus = view === "run"`; desktop sidebar width uses `navCollapsed || (runFocus && !runNavExpanded)`, where `runNavExpanded` is local state set to `true` when the user expands the rail while on the run view and reset when leaving it. The sidebar toggle calls the right setter in run focus.

- [ ] **Step 4: Verify**

Tests PASS; lint, typecheck, build. Manual: filters hide types, search dims non-matches, keyboard moves the selection and scrolls, header count tracks live events (fix 3), sidebar collapses on the run view and comes back elsewhere.

- [ ] **Step 5: Commit**

```bash
git add -A src
git commit -m "feat(ui): run view filters, search, keyboard selection and focus layout"
```

---

### Task 6: Inspector, transport bar, mobile timeline

**Files:**
- Create: `src/components/ui/json-view.tsx`, `src/components/ui/__tests__/json-view.test.ts`, `src/components/sequence-diagram/scrubber.ts`, `src/components/sequence-diagram/__tests__/scrubber.test.ts`, `src/components/sequence-diagram/transport-bar.tsx`
- Modify: `event-detail-panel.tsx`, `stacked-timeline.tsx`, `sequence-diagram.tsx`; delete `replay-controls.tsx`

**Interfaces:**
- Produces:
  - `tokenizeJson(text: string): { kind: "key" | "string" | "number" | "boolean" | "null" | "punct" | "space"; text: string }[]` and `<JsonView value: unknown />`.
  - `scrubberPositions(events): number[]` (0…1 per event, in seq order, monotonic non-decreasing; events with equal or out-of-order timestamps never go backwards; all-equal timestamps → evenly spaced by index; one event → `[0]`) and `indexAtPosition(positions, p): number` (nearest index; ties → lower index).
  - `<TransportBar events positions currentIndex isReplay isPlaying speed live onTogglePlay onSeek onSpeed onBackToLive />`.

- [ ] **Step 1: Failing tests**

```ts
// src/components/sequence-diagram/__tests__/scrubber.test.ts
import { describe, expect, it } from "vitest"
import { indexAtPosition, scrubberPositions } from "../scrubber"

const at = (...ms: number[]) => ms.map((t, i) => ({ seq: i, timestamp: new Date(1_700_000_000_000 + t).toISOString() }))

describe("scrubberPositions", () => {
  it("relative time from first to last", () => {
    expect(scrubberPositions(at(0, 500, 1000))).toEqual([0, 0.5, 1])
  })
  it("equal timestamps spread evenly", () => {
    expect(scrubberPositions(at(0, 0, 0, 0))).toEqual([0, 1 / 3, 2 / 3, 1])
  })
  it("out-of-order timestamps never go backwards (seq wins)", () => {
    const p = scrubberPositions(at(0, 1000, 400, 2000))
    expect(p).toEqual([...p].sort((a, b) => a - b))
    expect(p[0]).toBe(0)
    expect(p[3]).toBe(1)
  })
  it("single and empty", () => {
    expect(scrubberPositions(at(0))).toEqual([0])
    expect(scrubberPositions([])).toEqual([])
  })
})

describe("indexAtPosition", () => {
  const p = [0, 0.2, 0.9, 1]
  it("nearest event", () => {
    expect(indexAtPosition(p, 0.15)).toBe(1)
    expect(indexAtPosition(p, 0.6)).toBe(2)
    expect(indexAtPosition(p, 2)).toBe(3)
    expect(indexAtPosition(p, -1)).toBe(0)
  })
  it("ties go to the lower index", () => {
    expect(indexAtPosition([0, 1], 0.5)).toBe(0)
  })
})
```
```ts
// src/components/ui/__tests__/json-view.test.ts
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
```
Run → FAIL.

- [ ] **Step 2: Implement**

```ts
// scrubber.ts
export function scrubberPositions(events: { seq: number; timestamp: string }[]): number[] {
  if (events.length === 0) return []
  if (events.length === 1) return [0]
  const times: number[] = []
  let last = -Infinity
  for (const e of events) {
    const t = Math.max(new Date(e.timestamp).getTime(), last)
    times.push(t)
    last = t
  }
  const span = times[times.length - 1] - times[0]
  if (span <= 0) return times.map((_, i) => i / (times.length - 1))
  return times.map((t) => (t - times[0]) / span)
}

export function indexAtPosition(positions: number[], p: number): number {
  let best = 0
  for (let i = 1; i < positions.length; i++) {
    if (Math.abs(positions[i] - p) < Math.abs(positions[best] - p)) best = i
  }
  return best
}
```
```tsx
// json-view.tsx (tokenizer; component renders <pre> with token colours)
const TOKEN = /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false)\b|\b(null)\b|(\s+)|([{}[\],:])/g

export type JsonToken = { kind: "key" | "string" | "number" | "boolean" | "null" | "punct" | "space"; text: string }

export function tokenizeJson(text: string): JsonToken[] {
  const out: JsonToken[] = []
  for (const m of text.matchAll(TOKEN)) {
    if (m[1] !== undefined) {
      if (m[2] !== undefined) {
        out.push({ kind: "key", text: m[1] }, { kind: "punct", text: m[2] })
      } else out.push({ kind: "string", text: m[1] })
    } else if (m[3] !== undefined) out.push({ kind: "number", text: m[3] })
    else if (m[4] !== undefined) out.push({ kind: "boolean", text: m[4] })
    else if (m[5] !== undefined) out.push({ kind: "null", text: m[5] })
    else if (m[6] !== undefined) out.push({ kind: "space", text: m[6] })
    else out.push({ kind: "punct", text: m[7] })
  }
  return out
}
```
(The `key` regex includes the whitespace before the colon in group 2; the round-trip test proves nothing is lost. Colours: key `--ev-llm-text`, string `--ev-result-text`, number `--ev-handoff-text`, boolean/null `--ev-tool-text`, punct `--ink-2`; font `--font-data`.)

- [ ] **Step 3: UI**

- Inspector (`event-detail-panel.tsx`, desktop panel + mobile sheet): type badge (event colour 15 % fill), title (full label), `source → target`, then a definition list: Time (`HH:MM:SS.mmm`), Duration, Status, Position (`{index + 1} / {total}`), then Payload (`JsonView`, scrollable, max-height) with a "Copy JSON" button (clipboard + toast "Payload copied"). Empty state: "Select an arrow to inspect its payload." Collapsible as today (`useLayout().detailCollapsed`).
- `TransportBar` (bottom of the run view, visible when ≥ 2 events): play/pause button (`aria-label`), speed segmented control `0.5×`, `1×`, `2×`, `instant`, a scrubber track with one 2 px tick per event at `positions[i]` in its event colour, a playhead (`role="slider"`, `aria-valuemin=0`, `aria-valuemax={total-1}`, `aria-valuenow={currentIndex}`, ←/→ step, Home/End), pointer drag with `setPointerCapture` → `onSeek(indexAtPosition(positions, x / width))`; "Back to live" pill when `live && isReplay`. Pressing play or dragging enters replay (reuse the existing replay state machine in `SequenceDiagram`; delete `ReplayControls` and the toolbar "Replay" button).
- Mobile `StackedTimeline`: cards use tokens (surface, line, event colour stripe on the left, data font for times), arrival = 160 ms vertical slide+fade (fade only with reduced motion).

- [ ] **Step 4: Verify**

Tests PASS; lint, typecheck, build. Manual: scrub through a long run with mouse and keyboard; replay at each speed; "Back to live" while a run is running; copy JSON; mobile width (devtools 390 px) shows the restyled timeline.

- [ ] **Step 5: Commit**

```bash
git add -A src
git commit -m "feat(ui): inspector with JSON view, transport bar with scrubber, mobile timeline restyle"
```

---

## Phase 2 — Dashboard, projects, backend

### Task 7: Backend — UTC timestamps, `/api/timeline`, `/api/runs/recent`

**Files:**
- Create: `python-server/agenttrace/server/routes/timeline.py`, `python-server/tests/test_iso.py`, `python-server/tests/test_timeline.py`, `python-server/tests/test_recent_runs.py`
- Modify: `python-server/agenttrace/server/serializers.py`, `python-server/agenttrace/server/routes/runs.py`, `python-server/agenttrace/server/app.py`

**Interfaces:**
- Produces: the two JSON contracts from the spec, plus an optional `projectId` query parameter on both (needed by the projects list and project detail in Task 10 — an addition to the spec contract, same shapes). `_iso(dt)` always returns an explicit offset.

- [ ] **Step 1: Failing tests**

`python-server/tests/test_iso.py`:
```python
from datetime import datetime, timezone

from agenttrace.server.serializers import _iso


def test_naive_datetimes_are_treated_as_utc():
    assert _iso(datetime(2026, 10, 3, 12, 0, 0)) == "2026-10-03T12:00:00+00:00"


def test_aware_datetimes_keep_their_offset():
    assert _iso(datetime(2026, 10, 3, 12, 0, 0, tzinfo=timezone.utc)) == "2026-10-03T12:00:00+00:00"


def test_none():
    assert _iso(None) is None
```

Shared fixture style for the next two files (copy into each): a `local_client` fixture (`AGENTTRACE_AUTH=none`, `AGENTTRACE_ALLOWED_HOSTS=testserver`, `TestClient(app)`), and a helper that writes runs directly with the SDK store into the test DB so timestamps can be controlled:

```python
import os
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from agenttrace.server.app import app
from agenttrace.store import db as store_db
from agenttrace.store import events as store_events
from agenttrace.store import local, models


@pytest.fixture
def local_client(monkeypatch):
    monkeypatch.setenv("AGENTTRACE_AUTH", "none")
    monkeypatch.setenv("AGENTTRACE_ALLOWED_HOSTS", "testserver")
    with TestClient(app) as c:
        yield c


def make_run(project_name, name, *, hours_ago=0.0, status="completed", events=(), duration_s=2.0):
    url = os.environ["DATABASE_URL"]
    with store_db.get_sessionmaker(url)() as db:
        user = local.get_or_create_local_user(db)
        project = local.get_or_create_project(db, user, project_name)
        start = datetime.now(timezone.utc) - timedelta(hours=hours_ago)
        run = models.Run(project_id=project.id, name=name, status=status, started_at=start,
                         ended_at=None if status == "running" else start + timedelta(seconds=duration_s))
        db.add(run)
        db.commit()
        for source, target, type_ in events:
            store_events.append_event(db, run.id, {"source": source, "target": target, "type": type_})
        return run.id, project.id
```

`python-server/tests/test_timeline.py`:
```python
import uuid

from agenttrace.server.routes import timeline as timeline_route

# + the fixture/helper block above


def test_timeline_groups_runs_by_project_within_window(local_client):
    p = f"tl-{uuid.uuid4().hex[:6]}"
    inside, _ = make_run(p, "inside", hours_ago=2, events=[("User", "Orch", "handoff")])
    make_run(p, "too old", hours_ago=30)
    live_old, _ = make_run(p, "still running", hours_ago=40, status="running")
    body = local_client.get("/api/timeline?hours=24").json()
    project = next(x for x in body["projects"] if x["name"] == p)
    names = [r["name"] for r in project["runs"]]
    assert "inside" in names and "still running" in names and "too old" not in names
    run = next(r for r in project["runs"] if r["id"] == inside)
    assert run["eventCount"] == 1 and run["status"] == "completed" and run["startedAt"].endswith("+00:00")
    assert body["truncated"] is False
    starts = [r["startedAt"] for r in project["runs"]]
    assert starts == sorted(starts)


def test_projects_without_runs_are_listed(local_client):
    p = f"empty-{uuid.uuid4().hex[:6]}"
    make_run(p, "ancient", hours_ago=100)
    body = local_client.get("/api/timeline").json()
    assert next(x for x in body["projects"] if x["name"] == p)["runs"] == []


def test_cap_sets_truncated(local_client, monkeypatch):
    monkeypatch.setattr(timeline_route, "MAX_RUNS", 2)
    p = f"cap-{uuid.uuid4().hex[:6]}"
    for i in range(3):
        make_run(p, f"r{i}", hours_ago=1 + i * 0.1)
    body = local_client.get("/api/timeline").json()
    assert body["truncated"] is True
    assert sum(len(x["runs"]) for x in body["projects"]) == 2


def test_project_filter_and_bounds(local_client):
    p = f"filt-{uuid.uuid4().hex[:6]}"
    _, pid = make_run(p, "only", hours_ago=1)
    body = local_client.get(f"/api/timeline?projectId={pid}").json()
    assert [x["id"] for x in body["projects"]] == [pid]
    assert local_client.get("/api/timeline?projectId=nope").status_code == 404
    assert local_client.get("/api/timeline?hours=0").status_code == 422
    assert local_client.get("/api/timeline?hours=169").status_code == 422


def test_requires_login_in_password_mode(monkeypatch):
    monkeypatch.delenv("AGENTTRACE_AUTH", raising=False)
    from fastapi.testclient import TestClient as TC
    with TC(app) as c:
        assert c.get("/api/timeline").status_code == 401
```

`python-server/tests/test_recent_runs.py`:
```python
import uuid

# + the fixture/helper block above


def test_recent_runs_with_shape(local_client):
    p = f"rec-{uuid.uuid4().hex[:6]}"
    events = [("User", "Orch", "handoff"), ("Orch", "LLM", "llm_call"), ("Orch", "web_search", "tool_call"),
              ("web_search", "Orch", "tool_result")] + [("Orch", "LLM", "llm_call")] * 12
    run_id, pid = make_run(p, "shaped", hours_ago=0.01, status="running", events=events)
    body = local_client.get(f"/api/runs/recent?projectId={pid}").json()
    [run] = body["runs"]
    assert run["id"] == run_id and run["status"] == "running" and run["endedAt"] is None and run["durationMs"] is None
    assert run["eventCount"] == 16 and run["project"] == {"id": pid, "name": p}
    assert run["shape"]["participants"] == ["User", "Orch", "LLM", "web_search"]
    assert len(run["shape"]["events"]) == 12
    assert run["shape"]["events"][0] == {"s": 0, "t": 1, "type": "handoff", "status": "ok"}
    assert run["shape"]["events"][3] == {"s": 3, "t": 1, "type": "tool_result", "status": "ok"}


def test_recent_orders_newest_first_and_limits(local_client):
    p = f"ord-{uuid.uuid4().hex[:6]}"
    make_run(p, "older", hours_ago=2)
    make_run(p, "newer", hours_ago=1)
    _, pid = make_run(p, "newest", hours_ago=0.5)
    runs = local_client.get(f"/api/runs/recent?projectId={pid}&limit=2").json()["runs"]
    assert [r["name"] for r in runs] == ["newest", "newer"]
    assert runs[0]["durationMs"] == 2000


def test_recent_bounds_and_route_order(local_client):
    assert local_client.get("/api/runs/recent?limit=0").status_code == 422
    assert local_client.get("/api/runs/recent?limit=51").status_code == 422
    # /recent must not be captured by GET /api/runs/{run_id}
    assert "runs" in local_client.get("/api/runs/recent").json()
```
Run: `.venv/bin/pytest python-server/tests/test_iso.py python-server/tests/test_timeline.py python-server/tests/test_recent_runs.py -q` → FAIL.

- [ ] **Step 2: Implement**

`serializers.py`:
```python
from datetime import datetime, timezone


def _iso(dt: Optional[datetime]) -> Optional[str]:
    """SQLite hands back naive datetimes that are UTC: always emit an explicit
    offset so browsers don't read them as local time."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()
```

`routes/timeline.py`:
```python
"""GET /api/timeline — runs of the last N hours grouped by project, for the
dashboard chronogram (and a single project's, with ?projectId=)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from .. import models
from ..db import get_db
from ..deps import require_user
from ..serializers import _iso

router = APIRouter(prefix="/api/timeline", tags=["timeline"])

MAX_RUNS = 500


@router.get("")
def timeline(
    hours: int = Query(24, ge=1, le=168),
    projectId: Optional[str] = None,
    user: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    start = now - timedelta(hours=hours)
    projects_q = db.query(models.Project).filter(models.Project.user_id == user.id)
    if projectId:
        projects_q = projects_q.filter(models.Project.id == projectId)
    projects = projects_q.order_by(models.Project.created_at).all()
    if projectId and not projects:
        raise HTTPException(status_code=404, detail={"error": "Project not found"})

    ids = [p.id for p in projects]
    runs = (
        db.query(models.Run)
        .filter(models.Run.project_id.in_(ids), or_(models.Run.started_at >= start, models.Run.status == "running"))
        .order_by(models.Run.started_at.desc())
        .limit(MAX_RUNS + 1)
        .all()
        if ids
        else []
    )
    truncated = len(runs) > MAX_RUNS
    runs = runs[:MAX_RUNS]
    counts = dict(
        db.query(models.Event.run_id, func.count(models.Event.id))
        .filter(models.Event.run_id.in_([r.id for r in runs]))
        .group_by(models.Event.run_id)
        .all()
    ) if runs else {}

    by_project: dict[str, list] = {p.id: [] for p in projects}
    for r in sorted(runs, key=lambda r: r.started_at):
        by_project[r.project_id].append({
            "id": r.id, "name": r.name, "status": r.status,
            "startedAt": _iso(r.started_at), "endedAt": _iso(r.ended_at), "eventCount": counts.get(r.id, 0),
        })
    return {
        "from": _iso(start), "to": _iso(now), "truncated": truncated,
        "projects": [{"id": p.id, "name": p.name, "runs": by_project[p.id]} for p in projects],
    }
```
`app.py`: import `timeline` and `app.include_router(timeline.router)` with the other routers (before the `/api` catch-all).

`routes/runs.py` — add **above** the `@runs_router.get("/{run_id}")` handler:
```python
SHAPE_EVENTS = 12


def _shape(events: list[models.Event]) -> dict:
    participants: list[str] = []
    for ev in events:
        for name in (ev.source, ev.target):
            if name not in participants:
                participants.append(name)
    index = {name: i for i, name in enumerate(participants)}
    return {
        "participants": participants,
        "events": [{"s": index[e.source], "t": index[e.target], "type": e.type, "status": e.status} for e in events],
    }


@runs_router.get("/recent")
def recent_runs(
    limit: int = Query(12, ge=1, le=50),
    projectId: Optional[str] = None,
    user: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    q = db.query(models.Run).join(models.Project).filter(models.Project.user_id == user.id)
    if projectId:
        q = q.filter(models.Run.project_id == projectId)
    runs = q.order_by(models.Run.started_at.desc()).limit(limit).all()
    out = []
    for r in runs:
        first = db.query(models.Event).filter(models.Event.run_id == r.id).order_by(models.Event.seq).limit(SHAPE_EVENTS).all()
        count = db.query(func.count(models.Event.id)).filter(models.Event.run_id == r.id).scalar()
        duration = int((r.ended_at - r.started_at).total_seconds() * 1000) if r.ended_at else None
        out.append({
            "id": r.id, "name": r.name, "status": r.status,
            "startedAt": _iso(r.started_at), "endedAt": _iso(r.ended_at), "durationMs": duration,
            "eventCount": count, "project": {"id": r.project.id, "name": r.project.name},
            "shape": _shape(first),
        })
    return {"runs": out}
```
(Add the needed imports — `Optional`, `Query`, `func`, `_iso` — to `runs.py`.)

- [ ] **Step 3: Verify**

Run the three test files → PASS; then the full suite `.venv/bin/pytest python-server/tests -q` → all pass (existing tests that compare datetime strings must still pass; if one hard-codes a naive string, update it to the `+00:00` form and say so).

- [ ] **Step 4: Commit**

```bash
git add -A python-server
git commit -m "feat(server): UTC timestamps, /api/timeline and /api/runs/recent for the dashboard"
```

---

### Task 8: Mini diagrams and the run feed

**Files:**
- Create: `src/components/mini-diagram/mini-geometry.ts`, `src/components/mini-diagram/__tests__/mini-geometry.test.ts`, `src/components/mini-diagram/mini-diagram.tsx`, `src/components/dashboard/run-feed.tsx`
- Modify: `src/lib/types.ts` (types for the recent-runs payload)

**Interfaces:**
- Consumes: `GET /api/runs/recent` (Task 7), `subscribeRun` (`@/lib/live`), `DIAGRAM_STYLES`, `EVENT_COLORS`.
- Produces:
  - Types `RunShape = { participants: string[]; events: { s: number; t: number; type: EventType; status: EventStatus }[] }`, `RecentRun = { id; name; status: RunStatus; startedAt; endedAt; durationMs; eventCount; project: { id; name }; shape: RunShape }`.
  - `miniGeometry(shape, width, height, pad = 6): { lanes: number[]; arrows: { x1; x2; y; type; isReturn; isError; selfLoop }[] }`.
  - `<MiniDiagram shape width height />` (static), `<LiveMiniDiagram runId width height />` (fetches `/api/runs/{id}`, subscribes, draws the last 12 events with a simplified arrival per theme: pulse = pathLength draw + glow, pen = pathLength linear, spring = scaleX spring; fade with reduced motion).
  - `<RunFeed projectId?: string limit?: number />` — query key `["runs-recent", projectId ?? "all", limit]`, `refetchInterval` 5 000 ms while any returned run is running, else 30 000 ms.

- [ ] **Step 1: Failing test**

```ts
// src/components/mini-diagram/__tests__/mini-geometry.test.ts
import { describe, expect, it } from "vitest"
import { miniGeometry } from "../mini-geometry"

describe("miniGeometry", () => {
  const shape = {
    participants: ["User", "Orch", "LLM", "tool"],
    events: [
      { s: 0, t: 1, type: "handoff" as const, status: "ok" as const },
      { s: 1, t: 3, type: "tool_call" as const, status: "ok" as const },
      { s: 3, t: 1, type: "tool_result" as const, status: "ok" as const },
      { s: 1, t: 1, type: "llm_call" as const, status: "error" as const },
    ],
  }
  it("spreads lanes across the width", () => {
    const g = miniGeometry(shape, 160, 60)
    expect(g.lanes).toEqual([25, 62, 99, 136])
  })
  it("rows stay inside the box and keep order", () => {
    const g = miniGeometry(shape, 160, 60)
    const ys = g.arrows.map((a) => a.y)
    expect(ys).toEqual([...ys].sort((a, b) => a - b))
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(6)
    expect(Math.max(...ys)).toBeLessThanOrEqual(54)
  })
  it("flags returns, errors and self loops", () => {
    const g = miniGeometry(shape, 160, 60)
    expect(g.arrows[2].isReturn).toBe(true)
    expect(g.arrows[3].isError).toBe(true)
    expect(g.arrows[3].selfLoop).toBe(true)
  })
  it("empty and single-participant shapes do not produce NaN", () => {
    expect(miniGeometry({ participants: [], events: [] }, 100, 40)).toEqual({ lanes: [], arrows: [] })
    const one = miniGeometry({ participants: ["A"], events: [{ s: 0, t: 0, type: "llm_call", status: "ok" }] }, 100, 40)
    expect(one.lanes).toEqual([50])
    expect(Number.isNaN(one.arrows[0].y)).toBe(false)
  })
})
```
Run → FAIL.

- [ ] **Step 2: `mini-geometry.ts`**

```ts
import type { EventType, RunShape } from "@/lib/types"

export function miniGeometry(shape: RunShape, width: number, height: number, pad = 6) {
  const n = shape.participants.length
  if (n === 0) return { lanes: [] as number[], arrows: [] as MiniArrow[] }
  const laneW = (width - 2 * pad) / n
  const lanes = shape.participants.map((_, i) => Math.round(pad + laneW * (i + 0.5)))
  const rows = Math.max(1, shape.events.length)
  const rowH = (height - 2 * pad) / rows
  const arrows = shape.events.map((e, i): MiniArrow => ({
    x1: lanes[e.s] ?? lanes[0], x2: lanes[e.t] ?? lanes[0], y: pad + rowH * (i + 0.5),
    type: e.type, isReturn: e.type === "tool_result", isError: e.type === "error" || e.status === "error",
    selfLoop: e.s === e.t,
  }))
  return { lanes, arrows }
}

export interface MiniArrow { x1: number; x2: number; y: number; type: EventType; isReturn: boolean; isError: boolean; selfLoop: boolean }
```

- [ ] **Step 3: Components**

- `MiniDiagram`: `<svg viewBox>` with lifelines (`--line-strong`, the theme's lifeline dash from `DIAGRAM_STYLES[resolved]`), arrows 1 px (returns dashed), open/filled 3 px heads per theme, error cross, self loops as a small arc. `aria-hidden` (the tile carries the text).
- `RunFeed`: header row; if a run is `running`, the first running run renders as a wide tile (`LiveMiniDiagram` 2:1, name, project, "Live, {n} events" with the running pulse); the rest in a responsive grid (`grid-cols-1 sm:grid-cols-2 xl:grid-cols-3`) of tiles: mini diagram, hairline, status dot (`--st-*`), name (truncate, `title`), project, duration (`formatDuration`). Tiles are `<button>`s → `go("run", { runId, projectId })`; focus ring `--focus-ring`; hover raises with `--shadow-raised` (Studio) or a `--line-strong` border (dark themes) — no other hover animation. Empty: "No runs yet. Start your agent with `agenttrace.langchain.autolog()` and runs appear here live." + a "Load demo projects" button (`POST /api/seed`, invalidate `stats`, `timeline`, `runs-recent`, `projects`).

- [ ] **Step 4: Verify**

Tests PASS; lint, typecheck, build. Manual: feed renders demo runs as recognisable shapes; start the demo agent script → the live wide tile draws new events in each theme.

- [ ] **Step 5: Commit**

```bash
git add -A src
git commit -m "feat(ui): mini sequence diagrams and the live run feed"
```

---

### Task 9: Chronogram and the dashboard

**Files:**
- Create: `src/components/dashboard/chrono-scale.ts`, `src/components/dashboard/__tests__/chrono-scale.test.ts`, `src/components/dashboard/chronogram.tsx`, `src/components/dashboard/stat-strip.tsx`
- Modify: `src/components/views/dashboard-view.tsx` (rewrite)

**Interfaces:**
- Consumes: `GET /api/timeline` (Task 7), `GET /api/stats`, `RunFeed` (Task 8).
- Produces:
  - `chronoLayout(runs: { startedAt: string; endedAt: string | null; status: RunStatus }[], from: number, to: number, width: number, minWidth = 4): { x: number; w: number; startedBefore: boolean; live: boolean }[]` and `chronoTicks(from: number, to: number, count = 4): { x: number; label: string }[]` (labels `−24 h`, `−18 h`, `−12 h`, `−6 h`, `now` for 24 h; hours are rounded; the last label is `now`).
  - `<Chronogram projectId?: string hours?: number />` (query key `["timeline", projectId ?? "all", hours]`, refetch 5 s while any run is running, else 30 s; recomputes "now" every 10 s), `<StatStrip />`.

- [ ] **Step 1: Failing test**

```ts
// src/components/dashboard/__tests__/chrono-scale.test.ts
import { describe, expect, it } from "vitest"
import { chronoLayout, chronoTicks } from "../chrono-scale"

const H = 3_600_000
const from = Date.UTC(2026, 9, 3, 0, 0, 0)
const to = from + 24 * H
const iso = (t: number) => new Date(t).toISOString()

describe("chronoLayout", () => {
  it("positions by start time and sizes by duration", () => {
    const [r] = chronoLayout([{ startedAt: iso(from + 12 * H), endedAt: iso(from + 18 * H), status: "completed" }], from, to, 240)
    expect(r.x).toBeCloseTo(120)
    expect(r.w).toBeCloseTo(60)
    expect(r.live).toBe(false)
  })
  it("enforces a minimum width for short runs", () => {
    const [r] = chronoLayout([{ startedAt: iso(from + H), endedAt: iso(from + H + 1000), status: "completed" }], from, to, 240)
    expect(r.w).toBe(4)
  })
  it("running runs extend to now", () => {
    const [r] = chronoLayout([{ startedAt: iso(from + 20 * H), endedAt: null, status: "running" }], from, to, 240)
    expect(r.x + r.w).toBeCloseTo(240)
    expect(r.live).toBe(true)
  })
  it("crashed runs (no end, not running) get the minimum width", () => {
    const [r] = chronoLayout([{ startedAt: iso(from + 2 * H), endedAt: null, status: "failed" }], from, to, 240)
    expect(r.w).toBe(4)
    expect(r.live).toBe(false)
  })
  it("runs that started before the window are clamped to the left edge", () => {
    const [r] = chronoLayout([{ startedAt: iso(from - 5 * H), endedAt: null, status: "running" }], from, to, 240)
    expect(r.x).toBe(0)
    expect(r.startedBefore).toBe(true)
    expect(r.w).toBeCloseTo(240)
  })
  it("never returns NaN or negative widths", () => {
    const rows = chronoLayout([{ startedAt: iso(from + 3 * H), endedAt: iso(from + 2 * H), status: "completed" }], from, to, 240)
    expect(rows[0].w).toBeGreaterThanOrEqual(4)
    expect(Number.isNaN(rows[0].x)).toBe(false)
  })
})

describe("chronoTicks", () => {
  it("labels a 24 h window", () => {
    expect(chronoTicks(from, to).map((t) => t.label)).toEqual(["−24 h", "−18 h", "−12 h", "−6 h", "now"])
    expect(chronoTicks(from, to).map((t) => t.x)).toEqual([0, 0.25, 0.5, 0.75, 1])
  })
})
```
Run → FAIL.

- [ ] **Step 2: `chrono-scale.ts`**

```ts
import type { RunStatus } from "@/lib/types"

export function chronoLayout(
  runs: { startedAt: string; endedAt: string | null; status: RunStatus }[],
  from: number, to: number, width: number, minWidth = 4,
) {
  const span = Math.max(1, to - from)
  const px = (t: number) => ((t - from) / span) * width
  return runs.map((r) => {
    const start = new Date(r.startedAt).getTime()
    const live = r.status === "running"
    const end = r.endedAt ? new Date(r.endedAt).getTime() : live ? to : start
    const x = Math.min(width, Math.max(0, px(start)))
    const right = Math.min(width, Math.max(x, px(Math.max(end, start))))
    return { x, w: Math.max(minWidth, right - x), startedBefore: start < from, live }
  })
}

export function chronoTicks(from: number, to: number, count = 4) {
  const hours = Math.round((to - from) / 3_600_000)
  return Array.from({ length: count + 1 }, (_, i) => {
    const left = Math.round(hours * (1 - i / count))
    return { x: i / count, label: i === count ? "now" : `−${left} h` }
  })
}
```

- [ ] **Step 3: UI**

- `StatStrip`: one bordered strip with five cells (projects, runs, success rate, average duration, events) from `/api/stats`; value in data font 20 px `--ink`, label UI font 12 px `--ink-2` (sentence case); cells separated by `--line` hairlines; Cyanotype gets the title-block look naturally from the tokens (square, `--ink` border); skeleton while loading.
- `Chronogram`: panel with title "Last 24 hours"; left column of project names (UI font, truncate + `title`), right area with dashed row baselines (theme lifeline dash), tick grid + labels from `chronoTicks`, run segments as absolutely-positioned `<button>`s (`left/width` from `chronoLayout`), fill `color-mix(in oklab, var(--st-…) 22%, transparent)`, 1 px `--st-…` border, inner density ticks (one 1 px tick per ~3 px, capped at `eventCount`), `aria-label="{run name}, {status}, {duration}"`, native tooltip `title`; live segments get a soft pulse on their right edge (CSS keyframes on a pseudo-element; static with reduced motion); a dashed `--st-running` "now" line at the right; `truncated` → small note "Showing the latest 500 runs". Click → `go("run", …)`. Empty projects list → the same empty state as `RunFeed`.
- `DashboardView` rewrite: title row ("Dashboard" + "New project" button kept), `StatStrip`, `Chronogram`, `RunFeed limit={12}`. Remove the old stat cards, signal-mix and recent-activity blocks.

- [ ] **Step 4: Verify**

Tests PASS; lint, typecheck, build. Manual in each theme with the demo data + a live demo agent: segments at the right times (timezone fix makes "now" line up), live segment grows, clicking opens the run, feed below.

- [ ] **Step 5: Commit**

```bash
git add -A src
git commit -m "feat(ui): dashboard with stat strip, 24 h chronogram and run feed"
```

---

### Task 10: Projects list and project detail

**Files:**
- Modify: `src/components/views/projects-view.tsx`, `src/components/views/project-detail-view.tsx`

**Interfaces:**
- Consumes: `MiniDiagram`, `RunFeed`, `Chronogram` (Tasks 8–9), `/api/runs/recent?projectId=…&limit=1`, existing `/api/projects` and `/api/projects/{id}`.

- [ ] **Step 1: Projects list** — cards in a responsive grid: name (truncate + `title`), description (2 lines), the last run's `MiniDiagram` (query `["runs-recent", projectId, 1]`, placeholder lifelines while loading, "No runs yet" when empty), run count and success rate (from `/api/stats` `perProject`), last activity (`formatRelative`). Keep the edit/delete actions and dialogs; each `DialogContent` gets a `DialogDescription` (fix 5 — visually hidden when the dialog has no descriptive text). Empty list → "No projects yet." + "New project" + "Load demo projects".
- [ ] **Step 2: Project detail** — header (name, description, "Start a run", API keys link as today), `Chronogram projectId={id}` with a 24 h / 7 d toggle (`hours` 24 or 168), `RunFeed projectId={id} limit={24}`. The project query refetches every 5 s while any of its runs is running (fix 2 — `refetchInterval` from the query data), and `RunFeed`/`Chronogram` already poll faster while a run is live.
- [ ] **Step 3: Verify** — lint, typecheck, build, Python suite (unchanged). Manual: start the demo agent while on the project page → the new run appears within 5 s without navigating (fix 2); no Radix `Description` warning when opening the dialogs (fix 5).
- [ ] **Step 4: Commit**

```bash
git add -A src
git commit -m "feat(ui): projects with last-run mini diagrams; project detail with chronogram and live feed"
```

---

## Phase 3 — Entry surfaces and finish

### Task 11: Demo loop, boot sequences, sign-in

**Files:**
- Create: `src/components/demo/refund-scenario.ts`, `src/components/demo/__tests__/refund-scenario.test.ts`, `src/components/demo/demo-loop.tsx`
- Modify: `src/components/boot-screen.tsx`, `src/components/auth/auth-screen.tsx`

**Interfaces:**
- Produces:
  - `REFUND_SCENARIO: { at: number; event: Omit<TraceEvent, "id" | "runId" | "timestamp" | "seq"> }[]` (the five events of the spec, `at` = ms offsets 600, 1500, 2500, 3400, 4300) and `scenarioEvents(elapsedMs: number, base = Date.UTC(2026, 9, 3, 12)): TraceEvent[]` (events whose `at ≤ elapsed`, ids `demo-0…`, seq = index, timestamp `base + at`).
  - `<DemoLoop theme?: ThemeId className? />` — plays the scenario with `ThemedDiagram` (style = `DIAGRAM_STYLES[theme ?? resolved]`; when `theme` is given, wraps in `<div data-theme={theme}>`), loops after a 2.5 s pause at the end (≈ 7.5 s cycle); reduced motion → the full scenario, static; pauses when off-screen (`IntersectionObserver`) or the tab is hidden.

- [ ] **Step 1: Failing test**

```ts
// src/components/demo/__tests__/refund-scenario.test.ts
import { describe, expect, it } from "vitest"
import { REFUND_SCENARIO, scenarioEvents } from "../refund-scenario"

describe("refund scenario", () => {
  it("has the five spec events in order", () => {
    expect(REFUND_SCENARIO.map((s) => [s.event.source, s.event.target, s.event.type])).toEqual([
      ["User", "Orchestrator", "handoff"],
      ["Orchestrator", "LLM", "llm_call"],
      ["Orchestrator", "lookup_order", "tool_call"],
      ["lookup_order", "Orchestrator", "tool_result"],
      ["Orchestrator", "User", "final_answer"],
    ])
    expect(REFUND_SCENARIO[1].event.durationMs).toBe(480)
    expect(REFUND_SCENARIO[3].event.durationMs).toBe(220)
  })
  it("reveals events over time", () => {
    expect(scenarioEvents(0)).toHaveLength(0)
    expect(scenarioEvents(1600).map((e) => e.id)).toEqual(["demo-0", "demo-1"])
    expect(scenarioEvents(10_000)).toHaveLength(5)
    expect(scenarioEvents(10_000).map((e) => e.seq)).toEqual([0, 1, 2, 3, 4])
  })
})
```
Run → FAIL. Implement `refund-scenario.ts` (labels from the spec: "refund request", "classify intent", "lookup_order(4821)", "order found", "refund issued"; payloads small and plausible, e.g. `{ orderId: "4821" }`).

- [ ] **Step 2: DemoLoop** — drive `elapsed` with `requestAnimationFrame` (stop when not visible), feed `scenarioEvents(elapsed % 7500)` to `ThemedDiagram` (`live`, no selection, compact `LAYOUT` with `laneWidth: 130`, `rowHeight: 44`); when the cycle restarts, remount the diagram via a `key` so the arrivals replay.
- [ ] **Step 3: Boot sequences** (`boot-screen.tsx`, client-only after mount to avoid hydration mismatches; a module-level flag so it plays once per page load; ≤ 1.2 s; reduced motion → static logo + "Loading"): Phosphore — a 2 px `--ev-result` line expands horizontally, then vertically into the screen with a brief glow, logo fades in; Cyanotype — the drafting grid draws from the top-left (two gradients animating `background-size` from 0), the double sheet border strokes in, then a title block with "AgentTrace" stamps in (scale 1.06 → 1, opacity); Studio — four LEDs light in sequence (`--ev-handoff`, `--ev-llm`, `--ev-tool`, `--ev-result`), then the panel slides up 12 px and fades in. If the session resolves before the sequence ends, finish the sequence (no flash of the auth screen underneath).
- [ ] **Step 4: Sign-in** (`auth-screen.tsx`, password mode): ≥ 1024 px two columns — left the existing form (keep its logic and server error messages), right a `DemoLoop` in a framed canvas with a one-line caption "A live sequence diagram of your agent's signals."; smaller screens: form only, the loop hidden.
- [ ] **Step 5: Verify** — tests PASS; lint, typecheck, build; manual in each theme (password mode: `agenttrace ui --auth password` in a temp dir).
- [ ] **Step 6: Commit**

```bash
git add -A src
git commit -m "feat(ui): per-theme boot sequences and a sign-in screen with a live demo diagram"
```

---

### Task 12: Settings theme picker, Integration restyle, copy pass, cleanup

**Files:**
- Modify: `src/components/views/settings-view.tsx`, `src/components/views/integration-view.tsx`, `src/components/sequence-diagram/sequence-diagram.tsx` (`ListeningState` copy), `src/components/layout/footer.tsx`, any remaining `DialogContent`, `src/app/globals.css` (remove unused utilities)

- [ ] **Step 1: Settings → Appearance** — four selectable cards (`role="radio"` in a `role="radiogroup"` labelled "Theme", arrow-key navigation): Auto ("Follows your system: Studio in light mode, Cyanotype in dark mode", showing two small swatches) and one card per theme with a `DemoLoop theme={id}` preview (160 px tall), the theme name and a one-line description (Phosphore: "A measuring instrument: glowing signals that fade like a CRT trace."; Cyanotype: "An engineering drawing: Prussian-blue sheet, dimension lines, a title block."; Studio: "A light hardware instrument: key colours, springy arrows, LEDs."). Selecting calls `setPreference`. Keep demo data, account/local-mode and version sections.
- [ ] **Step 2: Integration** — code blocks: `--surface-0` background, `--line` border, `--font-data`, strings in `--ev-result-text`, comments in `--ink-3`, keys/flags in `--ev-llm-text` (simple line-based highlighter: `#`/`//` comments, quoted strings); copy buttons keep working; snippet content unchanged.
- [ ] **Step 3: Copy pass** — `ListeningState`: title "Waiting for the first event" (live) / "This run has no events" (finished), body explains what to do (live: "Events appear here the moment your agent sends them."; finished: "Start a new run or send events with the SDK."); replace remaining ALL-CAPS labels in the chrome (sidebar section label, footer) with sentence case; footer shows `live · /ws` only when connected-capable (keep simple: static text in `--ink-3`). Every failing `useQuery` view shows "Couldn't load {thing}. Check that `agenttrace ui` is running, then retry." with a Retry button (`refetch`).
- [ ] **Step 4: Cleanup** — `grep -rn "at-graticule\|at-scanlines\|at-glow\|at-radar\|at-dot\|oklch(" src`; remove dead utilities from `globals.css` and replace leftover hard-coded colours with tokens.
- [ ] **Step 5: Verify** — lint, typecheck, test, build; manual tour of every view in each theme; browser console clean (no React or Radix warnings).
- [ ] **Step 6: Commit**

```bash
git add -A src
git commit -m "feat(ui): theme picker with live previews, integration restyle, clearer empty and error states"
```

---

### Task 13: End-to-end coverage and CI screenshots

**Files:**
- Create: `python-server/tests_e2e/test_themes.py`
- Modify: `python-server/tests_e2e/conftest.py` (helpers reused), `.github/workflows/ci.yml` (upload screenshots), `.gitignore` (`python-server/tests_e2e/artifacts/`)

**Interfaces:**
- Consumes: the e2e fixtures (`local_server`, `password_server`), `data-theme`, `data-arrival`, `data-testid="diagram"`.

- [ ] **Step 1: Tests** — in `test_themes.py` (Playwright sync API, chromium):
  - `test_theme_switch_persists_without_flash`: an init script records every value `data-theme` takes (`MutationObserver` on `documentElement` + the initial value) into `window.__themes`; open the app, click the Phosphore swatch, reload; after load `window.__themes == ["phosphore"]` and `document.documentElement.dataset.theme == "phosphore"`.
  - `test_auto_follows_system`: new contexts with `color_scheme="dark"` / `"light"` and no stored preference → `cyanotype` / `studio`.
  - `test_run_view_each_theme_without_console_errors` (parametrised over the three themes; preference set via `context.add_init_script` writing `localStorage`): collect `console` messages of type `error`/`warning` and `pageerror`s while opening a demo run and selecting an event → none.
  - `test_reduced_motion_live_event`: context `reduced_motion="reduce"`; create a running run with `AgentTraceClient`, open it, log an event → the new arrow appears and every element carrying `data-arrival` has the value `fade`.
  - `test_theme_switch_mid_run_keeps_selection`: open a running run, select an event (inspector shows its title), switch theme from the sidebar, log another event → inspector still shows the selected title and the new event arrives.
  - `test_many_participants_scrolls`: a run with 12 participants (40-char names) → the diagram container's `scrollWidth > clientWidth`, no console errors.
  - `test_large_run_opens_quickly`: write a 1 000-event run with `AgentTraceClient`, open it and assert the diagram is visible and the inspector opens on click within 3 s of navigation (generous CI bound for the spec's 500 ms target; measure with `time.monotonic()` around `goto` → `expect(...).to_be_visible()`), and that the DOM holds far fewer arrow groups than 1 000 (virtualised).
  - `test_fresh_install_empty_states`: password-mode server, sign up → dashboard shows "No runs yet" and a "Load demo projects" button; clicking it fills the chronogram and the feed.
  - `test_capture_screenshots` (always last, never fails on content): for each theme save `dashboard-{theme}.png`, `run-{theme}.png`, `signin-{theme}.png` at 1440×900 into `python-server/tests_e2e/artifacts/` (create the dir; respect `AGENTTRACE_SCREENSHOT_DIR` if set, used by Task 14).
- [ ] **Step 2: CI** — e2e job: after the tests, `actions/upload-artifact@v4` with `name: theme-screenshots`, `path: python-server/tests_e2e/artifacts/`, `if: always()`.
- [ ] **Step 3: Verify** — `bun run build:ui && .venv/bin/pytest python-server/tests_e2e -q` three times in a row → all pass; screenshots exist.
- [ ] **Step 4: Commit**

```bash
git add -A python-server/tests_e2e .github/workflows/ci.yml .gitignore
git commit -m "test: e2e coverage for themes, reduced motion and empty states; CI theme screenshots"
```

---

### Task 14: README screenshots and docs

**Files:**
- Create: `docs/screenshots/{run,dashboard}-{phosphore,cyanotype,studio}.png`
- Modify: `README.md`, `python-server/README.md`; delete the outdated root screenshots only after checking nothing else references them (`grep -rn "run-view.png\|mobile.png\|mobile-run.png\|run-diagram.png\|final-diagram.png" --include=*.md .`)

- [ ] **Step 1:** Generate screenshots: `AGENTTRACE_SCREENSHOT_DIR=docs/screenshots .venv/bin/pytest python-server/tests_e2e/test_themes.py -k capture -q` (keep only the run and dashboard images).
- [ ] **Step 2:** README: a "Themes" section near the top (three run-view screenshots side by side with one-line descriptions, how to switch: sidebar swatches or Settings → Appearance, Auto follows the OS), update the image references, mention reduced-motion support. `python-server/README.md`: one line pointing to the themes section.
- [ ] **Step 3:** Verify links render (relative paths), commit:

```bash
git add -A README.md python-server/README.md docs/screenshots
git commit -m "docs: theme screenshots and README themes section"
```
