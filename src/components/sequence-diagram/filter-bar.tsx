"use client"

import type { ReactNode } from "react"
import { Search, X } from "lucide-react"
import { EVENT_COLORS, type EventType } from "@/lib/types"

const TYPES = Object.keys(EVENT_COLORS) as EventType[]

/** The run's live stream while it is running: before the first connection, connected, or dropped. */
export type LiveState = "connecting" | "listening" | "reconnecting"

interface Props {
  hidden: ReadonlySet<EventType>
  onToggle: (type: EventType) => void
  query: string
  onQuery: (query: string) => void
  /** Events matching the active search, or null without one. */
  matchCount: number | null
  /** The live stream's state while the run is running, else null. */
  live: LiveState | null
  /** Actions at the right end. */
  children?: ReactNode
}

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--focus-ring)]"

/** The run view's filter row: a chip per event type (shown / hidden), a search
 * that highlights matches, and the live stream's state. */
export function FilterBar({ hidden, onToggle, query, onQuery, matchCount, live, children }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--line)] px-3 py-2">
      <div
        role="group"
        aria-label="Event types"
        // Phones: one row that scrolls sideways; wider: the chips wrap if they must.
        className="-mx-3 flex w-[calc(100%+1.5rem)] items-center gap-1 overflow-x-auto px-3 [scrollbar-width:none] sm:mx-0 sm:w-auto sm:flex-wrap sm:overflow-visible sm:px-0"
      >
        {TYPES.map((type) => {
          const { color, label } = EVENT_COLORS[type]
          const off = hidden.has(type)
          return (
            <button
              key={type}
              type="button"
              aria-pressed={!off}
              title={off ? `Show ${label} events` : `Hide ${label} events`}
              onClick={() => onToggle(type)}
              className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] border px-2 text-[12px] whitespace-nowrap transition-colors hover:bg-[var(--surface-2)] ${FOCUS}`}
              style={{ color: off ? "var(--ink-3)" : "var(--ink)", borderColor: off ? "transparent" : "var(--line)" }}
            >
              <span aria-hidden className="size-2 rounded-full" style={{ background: color, opacity: off ? 0.3 : 1 }} />
              {label}
            </button>
          )
        })}
      </div>

      <div className="relative flex min-w-40 flex-1 items-center sm:max-w-64">
        <Search aria-hidden className="pointer-events-none absolute left-2 size-3.5 text-[var(--ink-2)]" />
        <input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && query) {
              e.preventDefault()
              onQuery("")
            }
          }}
          placeholder="Search events"
          aria-label="Search events"
          spellCheck={false}
          className={`h-7 w-full rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--surface-0)] pr-24 pl-7 text-[12px] text-[var(--ink)] placeholder:text-[var(--ink-2)] [&::-webkit-search-cancel-button]:appearance-none ${FOCUS}`}
        />
        <span aria-live="polite" className="pointer-events-none absolute right-7 font-mono text-[10px] whitespace-nowrap text-[var(--ink-2)]">
          {matchCount === null ? "" : matchCount === 0 ? "No matches" : `${matchCount} ${matchCount === 1 ? "match" : "matches"}`}
        </span>
        {query && (
          <button
            type="button"
            aria-label="Clear search"
            title="Clear search"
            onClick={() => onQuery("")}
            className={`absolute right-1 grid size-5 place-items-center rounded-[var(--radius-control)] text-[var(--ink-2)] hover:text-[var(--ink)] ${FOCUS}`}
          >
            <X aria-hidden className="size-3.5" />
          </button>
        )}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-3">
        {live && <LiveIndicator state={live} />}
        {children}
      </div>
    </div>
  )
}

function LiveIndicator({ state }: { state: LiveState }) {
  if (state !== "listening") {
    return (
      <span role="status" className="text-[12px] text-[var(--ink-2)]">
        {state === "connecting" ? "Connecting…" : "Reconnecting…"}
      </span>
    )
  }
  return (
    <span role="status" className="flex items-center gap-1.5 text-[12px] text-[var(--ink-2)]">
      <span aria-hidden className="relative flex size-2">
        <span className="at-pulse-ring absolute inline-flex size-full rounded-full" style={{ background: "var(--st-running)" }} />
        <span className="relative inline-flex size-2 rounded-full" style={{ background: "var(--st-running)" }} />
      </span>
      Listening
    </span>
  )
}
