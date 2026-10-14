# Themes & motion — design

Date: 2026-10-03
Status: approved in conversation, pending written review
Builds on: `2026-10-03-bundled-ui-design.md` (branch `feat/bundled-ui`,
PR #6). This work branches from it (`feat/themes-motion`).

## Goal

Give AgentTrace the best possible visuals and motion, with two jobs:

- **Impress** on the entry surfaces: boot, sign-in, dashboard, README
  screenshots.
- **Stay precise** in the run view, where engineers actually debug: motion
  explains the signal flow (you see a signal leave its source and reach its
  target) and never gets in the way of reading.

Three complete, switchable themes, each with its own palette, typography
and motion personality: **Phosphore**, **Cyanotype**, **Studio**.

Success criteria:

1. A user can switch between the three themes from the sidebar or Settings;
   the choice survives a reload with no flash of the wrong theme; on first
   launch the theme follows the OS (light → Studio, dark → Cyanotype).
2. A live run plays in each theme with that theme's arrival animation
   (pulse / pen / spring); with "reduce motion" enabled, events appear with
   a short fade and nothing travels.
3. The dashboard shows the stat strip, a 24 h chronogram and the run feed of
   mini diagrams; the live run's tile draws itself as events arrive.
4. A 1 000-event run opens in under 500 ms and scrolls at 60 fps on a
   mid-range laptop.
5. No console errors or React warnings on any screen in any theme.

## Decisions (from the conversation)

- Objective: both "wow" (entry surfaces) and precision (run view).
- **Three themes**, not a blend. Default **Auto**: OS light → Studio, OS dark
  → Cyanotype; any explicit choice is remembered in the browser.
- Dashboard: **stat strip + chronogram + run feed** (both layouts combined).
- Run view structure approved: type filters + search, activation bars,
  inspector, transport bar with scrubber, sidebar collapsed on this view;
  mobile keeps the vertical stacked timeline, restyled per theme.
- Architecture: CSS-variable tokens + one component tree + a per-theme
  **diagram style** object. Rejected: three separate component trees (triple
  maintenance); tokens only (loses the motion personalities).
- Bugs seen during the demo are in scope (see "Fixes").

## Themes

### Tokens

The active theme is `document.documentElement.dataset.theme` ∈
`phosphore | cyanotype | studio`. Every theme defines the same CSS custom
properties (in `src/app/themes.css`), consumed through Tailwind's `@theme
inline` mapping:

| Token | Role |
| --- | --- |
| `--surface-0` | page / diagram canvas |
| `--surface-1` | panels, sidebar |
| `--surface-2` | raised elements (headers, tiles, popovers) |
| `--line`, `--line-strong` | borders, lifelines, dividers |
| `--ink`, `--ink-2`, `--ink-3` | primary / secondary / tertiary text |
| `--ev-handoff`, `--ev-llm`, `--ev-tool`, `--ev-result`, `--ev-answer`, `--ev-error` | event strokes & fills |
| `--ev-*-text` | event colour usable for text (≥ 4.5:1 on `--surface-1`) |
| `--st-running`, `--st-ok`, `--st-failed` | run status |
| `--font-ui`, `--font-data` | interface / data (mono) typefaces |
| `--radius-panel`, `--radius-control` | corner radii |
| `--shadow-raised` | elevation (none for the dark themes) |
| `--focus-ring` | keyboard focus outline colour |

The existing shadcn variables (`--background`, `--card`, `--primary`, …)
are kept as aliases of these tokens so the UI primitives keep working.
Hard-coded colours in `src/lib/types.ts` (`EVENT_COLORS`, `KIND_COLOR`) and
in components become references to the event/kind tokens.

### Palettes and type

**Phosphore** — a measuring instrument; dark blue-slate glass, one
calibrated colour per signal channel, glow only on moving signals.

| | |
| --- | --- |
| surfaces | `#0C151C` / `#101D25` / `#152631` |
| lines | `#22343E` / `#2E4A57` |
| ink | `#D6E7EE` / `#8FB3BF` / `#5E7C88` |
| events | handoff `#F5B83D`, llm `#4FD1E8`, tool `#A78BFA`, result `#4ADE9C`, answer `#F472B6`, error `#FF6B6B` |
| status | running `#F5B83D`, ok `#4ADE9C`, failed `#FF6B6B` |
| type | Instrument Sans (UI), Martian Mono (data) |
| shape | radius 6 px panels / 4 px controls, no shadows |

**Cyanotype** — a sequence diagram is an engineering drawing: Prussian-blue
sheet, pale inks, dimension lines, a title block.

| | |
| --- | --- |
| surfaces | `#10335A` / `#0C2A4B` / `#143C68` |
| lines | `#3A5F88` / `#9DB7D6` |
| ink | `#EAF2FF` / `#9DB7D6` / `#6F8DB0` |
| events | handoff `#FFC56B`, llm `#8FE3FF`, tool `#C9B8FF`, result `#9BF0C4`, answer `#FF9FC8`, error `#FF8A8A` |
| status | running `#FFC56B`, ok `#9BF0C4`, failed `#FF8A8A` |
| type | B612 (UI), B612 Mono (data) — designed for Airbus cockpit legibility |
| shape | radius 2 px, square panels with a fine double-line sheet border, drafting grid (10 px minor / 50 px major) |

**Studio** — a light hardware instrument: aluminium body, saturated key
colours, springy mechanics, LEDs.

| | |
| --- | --- |
| surfaces | `#E3E6EA` / `#F5F6F8` / `#FFFFFF` |
| lines | `#C3C8D0` / `#A9B0BA` |
| ink | `#1D2026` / `#5B6270` / `#8A919C` |
| events | handoff `#FF6A13`, llm `#2F6BFF`, tool `#7A4DFF`, result `#12B76A`, answer `#F0387F`, error `#E5383B` |
| status | running `#FF6A13`, ok `#12B76A`, failed `#E5383B` |
| type | Bricolage Grotesque (UI), DM Mono (data) |
| shape | radius 10 px panels / 7 px tiles, soft two-layer shadow |

Each theme's `--ev-*-text` values are chosen (darker on Studio, lighter on
the dark themes) to reach 4.5:1 against `--surface-1`; strokes reach at least
3:1 against `--surface-0`. The implementation verifies these ratios in a unit
test.

### Fonts

Bundled with `@fontsource/*` packages (static export, no network at build
time): `instrument-sans`, `martian-mono`, `b612`, `b612-mono`,
`bricolage-grotesque`, `dm-mono` — only the weights used (400 and 600/700).
`@font-face` rules for all three themes are present; browsers download only
the faces the active theme uses. The `geist` package is removed.

### Theme selection

- Store (zustand, persisted to `localStorage` key `agenttrace-theme`, wrapped
  in try/catch): `preference: "auto" | "phosphore" | "cyanotype" | "studio"`.
- `auto` resolves via `matchMedia("(prefers-color-scheme: dark)")` and
  follows OS changes live.
- **No flash:** a small inline script in `<head>` (in `layout.tsx`) reads the
  stored preference and the media query and sets `data-theme` before first
  paint; React then hydrates with the same value.
- **Switcher:** three swatches at the bottom of the sidebar (tooltip with the
  theme name; "Auto" as a fourth small control) and a Settings section with
  the three animated previews (each theme playing the "refund" scenario
  defined under Screens → Sign-in).
- **Switch transition:** View Transitions API — the new theme is revealed in
  a circle expanding from the clicked swatch (~450 ms). Fallback: 200 ms
  cross-fade. No transition with reduced motion.

## Diagram rendering and motion

### One renderer, three styles

`src/components/sequence-diagram/` keeps one SVG renderer; theme
differences live in `src/lib/diagram-styles.ts`:

```ts
type ThemeId = "phosphore" | "cyanotype" | "studio"
interface DiagramStyle {
  theme: ThemeId
  header: "box" | "titled" | "tile"          // participant header variant
  lifeline: { dash: string; width: number }   // e.g. "1.5 3" | "7 2 1.2 2" | "" (solid)
  arrow: { width: number; head: "filled" | "open"; returnDash: string }
  arrival: "pulse" | "pen" | "spring"         // how a NEW arrow appears
  afterglow: boolean                          // trace fades to a resting opacity
  duration: "label" | "dimension" | "chip"    // how durationMs is drawn
  decorations: Array<"vignette" | "titleBlock" | "leds">
  timing: { drawMs: number; settleMs: number; cascadeMs: number }
}
```

| | Phosphore | Cyanotype | Studio |
| --- | --- | --- | --- |
| header | rounded box, mono name | box with a rule, mono name | white tile with LED + name |
| lifeline | dotted | centre line (dash-dot) | solid hairline |
| arrival | bright pulse travels source → target, ripple at target | plotter pen (crosshair nib) traces the line | line springs out with ~6 px overshoot, target LED lights |
| afterglow | yes: full brightness → 55 % over 1.6 s | no | no |
| duration | small coloured label under the arrow | dimension line with ticks | rounded chip |
| decorations | vignette | title block (run name, project, status, duration, events) bottom-right | LEDs on participant tiles |
| draw / settle | 500 ms / 1 600 ms | 550 ms / 300 ms | 420 ms spring / 1 100 ms LED |

Shared conventions (all themes): tool results are drawn **dashed** (UML
return messages) and errors carry a **cross marker** at the arrowhead, so an
event's type reads without relying on colour.

### Motion rules

- Only **newly arrived** events animate. Opening an existing run draws it
  with one short cascade (`cascadeMs` ≤ 400 ms total, capped to the first
  40 visible rows); replay re-animates events at the replay speed.
- **Activation bars**: computed by a pure function — each `tool_call`
  whose target is participant X is paired with the next `tool_result` whose
  source is X; the bar spans the two rows on X's lifeline. An unmatched call
  (tool still working) extends to the live cursor.
- **Virtualisation**: above 200 events only rows inside the viewport (plus
  an overscan of 20 rows) are rendered; the SVG keeps its full height so
  scrolling stays native. The window is a pure function, unit-tested.
- **Reduced motion** (`prefers-reduced-motion: reduce`): no travelling pulse,
  pen or spring; new events fade in over 120 ms; no boot sequence; no theme
  reveal.
- **Keyboard**: ↑/↓ move the selection between events, Home/End jump to
  first/last, Esc clears; the selected event scrolls into view; focus ring
  uses `--focus-ring`.
- No `cx`/`cy` attribute animation (source of the current
  `<circle> cx: "undefined"` error): moving elements use transforms.

### Run view structure

- **Header**: breadcrumb (project), run name, status badge (pulsing while
  running), event count and duration (derived from the diagram's merged event
  list — fixes the lagging counter), Close / Delete actions.
- **Filter bar**: one chip per event type (toggle visibility; hidden types
  stay in the inspector's sequence numbering) + a text search over labels
  that highlights matches and dims the rest.
- **Canvas**: themed diagram as above.
- **Inspector** (right, collapsible): type badge, source → target, time,
  duration, status, position ("6 / 8"), payload as syntax-highlighted JSON
  using the theme's data font, copy button.
- **Transport bar** (bottom): play/pause, speed (0.5×, 1×, 2×, instant), a
  scrubber where each event is a coloured tick at its relative time, a
  draggable playhead (pointer + keyboard), and "Back to live" while a running
  run is being replayed.
- The sidebar auto-collapses on this view (the user can re-open it).
- Mobile (< 768 px): the existing vertical stacked timeline, restyled with
  the theme tokens and arrival style (pulse / pen / spring reduced to a
  vertical motion).

## Screens

- **Boot** (shown while the session loads, at most once per page load,
  skipped with reduced motion), ≤ 1.2 s:
  - Phosphore: CRT power-on — a bright horizontal line opens into the screen.
  - Cyanotype: the drafting grid draws from the top-left corner, then the
    title block stamps in.
  - Studio: the four participant LEDs light in sequence, then the panel
    slides up.
- **Sign-in** (password mode): form on the left; on the right, a looping demo
  sequence diagram in the active theme's style. The "refund" scenario:
  User → Orchestrator "refund request" (handoff); Orchestrator → LLM
  "classify intent" (llm_call, 480 ms); Orchestrator → lookup_order
  "lookup_order(4821)" (tool_call); lookup_order → Orchestrator "order found"
  (tool_result, 220 ms); Orchestrator → User "refund issued" (final_answer).
  Errors use the server message.
- **Dashboard**: stat strip (projects, runs, success rate, average duration,
  events) → **chronogram** (last 24 h, one row per project, each run a
  segment coloured by status at its start time, width ∝ duration with a
  minimum, live runs growing against a "now" line; hover shows name and
  duration; click opens the run) → **run feed** (12 most recent runs as mini
  diagrams; the live run gets a wide tile that draws its new events).
- **Projects**: cards with the last run's mini diagram, run count and success
  rate. **Project detail**: the project's chronogram + its run feed; refetches
  every 5 s while any of its runs is running (fixes "new run doesn't appear").
- **Run view**: as above.
- **Integration**: restyled code blocks (theme data font, token colours).
- **Settings**: theme picker (Auto + three animated previews of the refund
  scenario), demo data,
  account / local-mode note, version.
- **Empty and error states**: written as directions — e.g. "No runs yet.
  Start your agent with `agenttrace.langchain.autolog()` and runs appear here
  live."

## Backend additions

All require the session user (local user in `--auth none` mode), like the
other dashboard routes.

**`GET /api/timeline?hours=24`** (`hours` 1–168, default 24):

```json
{
  "from": "2026-10-02T12:00:00+00:00",
  "to": "2026-10-03T12:00:00+00:00",
  "truncated": false,
  "projects": [
    {
      "id": "…", "name": "Customer Support Agent",
      "runs": [
        {"id": "…", "name": "Refund — Order #4821", "status": "completed",
         "startedAt": "…", "endedAt": "…", "eventCount": 9}
      ]
    }
  ]
}
```

Runs that started in the window or are still running; most recent 500 at
most (`truncated: true` when capped); every project of the user is listed,
including those with no runs in the window.

**`GET /api/runs/recent?limit=12`** (`limit` 1–50, default 12):

```json
{
  "runs": [
    {
      "id": "…", "name": "…", "status": "running",
      "startedAt": "…", "endedAt": null, "durationMs": null, "eventCount": 7,
      "project": {"id": "…", "name": "…"},
      "shape": {
        "participants": ["User", "Orchestrator", "LLM", "web_search"],
        "events": [{"s": 0, "t": 1, "type": "handoff", "status": "ok"}]
      }
    }
  ]
}
```

`shape.participants` in first-appearance order (same rule as the frontend's
`extractParticipants`); `shape.events` = the first 12 events by `seq`.

**Timezone fix**: `serializers._iso` treats naive datetimes (SQLite returns
naive values) as UTC and always emits an explicit offset (`+00:00`). Fixes
the 2-hour skew seen in the demo.

## Fixes (seen during the demo)

1. Timestamps shifted by the browser's UTC offset (backend `_iso`).
2. Project page doesn't show a new run until you navigate away and back.
3. Run header event count lags behind the diagram.
4. `<circle> attribute cx: Expected length, "undefined"` console error.
5. Radix warning "Missing `Description` or `aria-describedby`" on dialogs —
   every dialog gets a `DialogDescription` (visually hidden where needed).

## Testing

- **Vitest** (new, `bun run test`): theme resolution (auto vs explicit,
  storage failures), contrast ratios of every theme's text/stroke tokens,
  activation-bar pairing, chronogram time scale, virtualisation window,
  mini-diagram shape → coordinates, scrubber position ↔ event index.
- **Python**: `/api/timeline` (window, cap + `truncated`, empty projects,
  auth in both modes), `/api/runs/recent` (shape order, 12-event cap, limit
  bounds), `_iso` with naive and aware datetimes.
- **Playwright** (existing e2e job):
  - theme switch via the sidebar persists across reload and the first paint
    already carries the stored `data-theme` (no flash);
  - the run view renders in each theme with zero console errors/warnings;
  - with `reducedMotion: "reduce"`, a live event appears without the arrival
    animation;
  - screenshots of dashboard, run view and sign-in in each theme are saved as
    a CI artifact for visual review (not pixel-diffed).

## Phases

1. **Theme foundation + run view**: tokens, fonts, store, no-flash script,
   switcher + transition, themed diagram renderer with the three arrival
   styles, UML conventions, activation bars, virtualisation, filters, search,
   inspector, transport bar, keyboard, fixes 3–5.
2. **Dashboard & projects + backend**: the two endpoints, timezone fix,
   mini-diagram component, chronogram, dashboard, projects, project detail,
   fix 2.
3. **Entry surfaces & finish**: boot sequences, sign-in demo loop, Settings
   theme picker, Integration restyle, empty/error copy, Playwright coverage
   and CI screenshots, README screenshots refreshed.

Each phase ends with a working, shippable UI.

## Out of scope

- URL routing / deep links.
- New product features beyond the run-view additions listed above.
- A light "whiteprint" variant of Cyanotype, dark variant of Studio, or a
  theme editor.
- Server-side preference storage (themes are per-browser).
