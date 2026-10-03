"use client"

import type { ReactNode } from "react"
import { formatDuration } from "@/lib/api"
import type { RunStatus } from "@/lib/types"

export interface RunMeta {
  name: string
  project: string
  status: RunStatus
  startedAt: string
  endedAt: string | null
}

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

const STATUS: Record<RunStatus, { label: string; color: string }> = {
  running: { label: "Running", color: "var(--st-running)" },
  completed: { label: "Completed", color: "var(--st-ok)" },
  failed: { label: "Failed", color: "var(--st-failed)" },
}

/** Cyanotype: the drawing's title block, pinned to the bottom-right of the
 * sheet while the diagram scrolls (it must sit in the content column). */
export function TitleBlock({ run, eventCount, lastEventAt }: { run: RunMeta; eventCount: number; lastEventAt: string | null }) {
  const status = STATUS[run.status] ?? { label: run.status, color: "var(--ink-3)" }
  const end = run.endedAt ?? lastEventAt
  const ms = end ? Math.max(0, new Date(end).getTime() - new Date(run.startedAt).getTime()) : null
  return (
    <div
      data-testid="title-block"
      className="sticky right-3 bottom-3 z-10 mt-auto mr-3 mb-3 w-max min-w-64 max-w-[min(26rem,calc(100%-1.5rem))] shrink-0 self-end font-mono text-[var(--ink)]"
      style={{ background: "var(--canvas)", border: "1px solid var(--ink)" }}
    >
      <div className="px-2.5 pt-1.5 pb-2" style={{ borderBottom: "1px solid var(--line-strong)" }}>
        <p className="text-[9px] leading-none text-[var(--ink-2)]">Run</p>
        <p className="mt-1.5 truncate text-[12px] leading-none" title={run.name}>
          {run.name}
        </p>
      </div>
      <dl className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto]">
        <Cell label="Project" title={run.project}>
          {run.project}
        </Cell>
        <Cell label="Status">
          <span aria-hidden className="mr-1.5 inline-block size-1.5 rounded-full align-middle" style={{ background: status.color }} />
          {status.label}
        </Cell>
        <Cell label="Duration">{formatDuration(ms)}</Cell>
        <Cell label="Events" last>
          {eventCount}
        </Cell>
      </dl>
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
