"use client"

import { useNav } from "@/lib/store"

export function Footer() {
  const { view } = useNav()
  return (
    <footer className="mt-auto shrink-0 border-t border-border bg-sidebar/40 px-4 sm:px-6 py-3">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-2 font-mono">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-60 at-pulse-ring" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
          </span>
          <span className="uppercase tracking-widest">ingestion: ready</span>
          <span className="text-border">·</span>
          <span>/ws live-stream</span>
        </div>
        <div className="flex items-center gap-3 font-mono">
          <span className="uppercase tracking-widest">view: {view}</span>
          <span className="text-border">·</span>
          <span>AgentTrace v1.0</span>
        </div>
      </div>
    </footer>
  )
}
