"use client"

import { useState, type ReactNode } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"
import { formatDuration } from "@/lib/api"
import { RUN_STATUS, type RunStatus } from "@/lib/types"

export interface RunMeta {
  name: string
  project: string
  status: RunStatus
  startedAt: string
  endedAt: string | null
  /** The whole run's event count and latest event, when the diagram shows only some of them (filters). */
  eventCount?: number
  lastEventAt?: string | null
}

/** Below this canvas height the title block opens as a single row (run name and
 * status): at 1024×700 the canvas is about 560 px and the full block hides rows. */
export const TITLE_BLOCK_COMPACT_BELOW = 600

/** Phosphore: the edges of the glass fall off towards the canvas colour. Sits
 * over the scroll viewport (not inside it) so it stays put while events scroll.
 * It also dims the text under it, so it stays light: at most 22 % in the very
 * corners keeps a bottom-left gutter time (--ink-3) at about 3:1. */
export function Vignette() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{
        background: "radial-gradient(ellipse at 50% 50%, transparent 60%, color-mix(in oklab, var(--surface-0) 22%, transparent))",
      }}
    />
  )
}

/** Cyanotype: the drawing's title block, pinned to the bottom-right of the
 * sheet while the diagram scrolls (it must sit in the content column). On a
 * short canvas it opens as a single row. Clicks pass through it to the arrows
 * underneath, except on its expand / collapse control. */
export function TitleBlock({ run, eventCount, lastEventAt, short }: { run: RunMeta; eventCount: number; lastEventAt: string | null; short: boolean }) {
  // The reader's choice, once made, outlasts canvas resizes.
  const [chosen, setChosen] = useState<boolean | null>(null)
  const expanded = chosen ?? !short
  const status = RUN_STATUS[run.status] ?? { label: run.status, color: "var(--ink-3)" }
  const end = run.endedAt ?? lastEventAt
  const ms = end ? Math.max(0, new Date(end).getTime() - new Date(run.startedAt).getTime()) : null
  const dot = <span aria-hidden className="mr-1.5 inline-block size-1.5 rounded-full align-middle" style={{ background: status.color }} />
  const toggle = (
    <button
      type="button"
      aria-expanded={expanded}
      aria-label={expanded ? "Hide run details" : "Show run details"}
      title={expanded ? "Hide run details" : "Show run details"}
      onClick={() => setChosen(!expanded)}
      className="pointer-events-auto -my-1 -mr-1 ml-auto grid size-5 shrink-0 place-items-center text-[var(--ink-2)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]"
    >
      {expanded ? <ChevronDown aria-hidden className="size-3.5" /> : <ChevronUp aria-hidden className="size-3.5" />}
    </button>
  )
  return (
    <div
      data-testid="title-block"
      data-expanded={expanded}
      className={
        "pointer-events-none sticky right-3 bottom-3 z-10 mt-auto mr-3 mb-3 w-max shrink-0 self-end font-mono text-[var(--ink)] " +
        (expanded ? "min-w-64 max-w-[min(26rem,calc(100%-1.5rem))]" : "max-w-[min(20rem,calc(100%-1.5rem))]")
      }
      style={{ background: "var(--canvas)", border: "1px solid var(--ink)" }}
    >
      {expanded ? (
        <>
          <div className="px-2.5 pt-1.5 pb-2" style={{ borderBottom: "1px solid var(--line-strong)" }}>
            <div className="flex items-start gap-2">
              <p className="text-[9px] leading-none text-[var(--ink-2)]">Run</p>
              {toggle}
            </div>
            <p className="mt-1.5 truncate text-[12px] leading-none" title={run.name}>
              {run.name}
            </p>
          </div>
          <dl className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto]">
            <Cell label="Project" title={run.project}>
              {run.project}
            </Cell>
            <Cell label="Status">
              {dot}
              {status.label}
            </Cell>
            <Cell label="Duration">{formatDuration(ms)}</Cell>
            <Cell label="Events" last>
              {eventCount}
            </Cell>
          </dl>
        </>
      ) : (
        <div className="flex items-center gap-2.5 px-2.5 py-1.5 text-[11px] leading-none">
          <span className="min-w-0 truncate" title={run.name}>
            {run.name}
          </span>
          <span className="shrink-0 whitespace-nowrap pl-2.5" style={{ borderLeft: "1px solid var(--line-strong)" }}>
            {dot}
            {status.label}
          </span>
          {toggle}
        </div>
      )}
    </div>
  )
}

function Cell({ label, title, last, children }: { label: string; title?: string; last?: boolean; children: ReactNode }) {
  return (
    <div className="min-w-0 px-2.5 pt-1.5 pb-2" style={last ? undefined : { borderRight: "1px solid var(--line-strong)" }}>
      <dt className="text-[9px] leading-none text-[var(--ink-2)]">{label}</dt>
      <dd className="mt-1.5 truncate text-[11px] leading-none whitespace-nowrap" title={title}>
        {children}
      </dd>
    </div>
  )
}
