"use client"

import { useSession } from "@/lib/session"

export function Footer() {
  const { version } = useSession()
  return (
    <footer className="mt-auto shrink-0 border-t border-border bg-sidebar/40 px-4 sm:px-6 py-3">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-[var(--ink-3)]">
        <div className="flex items-center gap-2">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--st-ok)] opacity-60 at-pulse-ring" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--st-ok)]" />
          </span>
          <span>Ingestion ready</span>
          <span aria-hidden>·</span>
          <span className="font-mono">live · /ws</span>
        </div>
        <span>
          LaneTrace <span className="at-clock">{version ? `v${version}` : ""}</span>
        </span>
      </div>
    </footer>
  )
}
