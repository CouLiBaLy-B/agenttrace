"use client"

import { memo, useRef } from "react"
import { AlertTriangle, ArrowRight } from "lucide-react"
import { eventPaint, detectParticipantKind, type Participant, type TraceEvent } from "@/lib/types"
import { formatDuration } from "@/lib/api"
import { cn } from "@/lib/utils"
import { PARTICIPANT_ICON, KIND_COLOR } from "./participants"
import { EventBadge } from "./event-badge"
import { clockTime } from "./format"
import { useFollowEnd } from "./follow"

interface Props {
  events: TraceEvent[]
  participants: Participant[]
  selectedId: string | null
  onSelect: (id: string) => void
  /** Open at the end and keep new events in view while the reader stays there (a live run). */
  follow?: boolean
  /** Changing it scrolls to the end and resumes following (a replay seek reveals the playhead's card). */
  revealKey?: number
}

/** Phones: the run as a vertical list of event cards. */
export function StackedTimeline({ events, selectedId, onSelect, follow = false, revealKey = 0 }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  useFollowEnd(scrollRef, follow, events.length, revealKey)
  return (
    <div ref={scrollRef} className="at-canvas at-scroll h-full space-y-2 overflow-y-auto p-3">
      {events.map((ev) => (
        <EventCard key={ev.id} event={ev} selected={ev.id === selectedId} onSelect={onSelect} />
      ))}
    </div>
  )
}

const EventCard = memo(function EventCard({
  event: ev,
  selected,
  onSelect,
}: {
  event: TraceEvent
  selected: boolean
  onSelect: (id: string) => void
}) {
  const paint = eventPaint(ev.type, ev.status === "error")
  const srcKind = detectParticipantKind(ev.source)
  const tgtKind = detectParticipantKind(ev.target)
  const SrcIcon = PARTICIPANT_ICON[srcKind]
  const TgtIcon = PARTICIPANT_ICON[tgtKind]
  return (
    <button
      type="button"
      onClick={() => onSelect(ev.id)}
      aria-pressed={selected}
      className={cn(
        // A new card slides in (CSS, so long runs stay cheap); a fade with reduced motion.
        "at-card-in relative block w-full overflow-hidden rounded-[var(--radius-panel)] border py-2.5 pr-3 pl-4 text-left transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
        selected
          ? "border-[var(--line-strong)] bg-[var(--surface-2)]"
          : "border-[var(--line)] bg-[var(--surface-1)] hover:border-[var(--line-strong)]"
      )}
      style={{ boxShadow: selected ? `inset 0 0 0 1px ${paint.color}, var(--shadow-raised)` : "var(--shadow-raised)" }}
    >
      {/* event colour stripe */}
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ background: paint.color }} />
      <span className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 font-mono text-[11px] text-[var(--ink-2)] tabular-nums">#{ev.seq}</span>
          <EventBadge type={ev.type} status={ev.status} />
        </span>
        <span className="shrink-0 font-mono text-[11px] text-[var(--ink-2)] tabular-nums">
          <span className="at-clock">{clockTime(ev.timestamp)}</span>
          {ev.durationMs != null && <> · {formatDuration(ev.durationMs)}</>}
        </span>
      </span>
      <span className="mt-1.5 flex min-w-0 items-center gap-1.5 font-mono text-[12px] text-[var(--ink)]">
        <SrcIcon aria-hidden className="size-3.5 shrink-0" style={{ color: KIND_COLOR[srcKind] }} />
        <span className="truncate">{ev.source}</span>
        <ArrowRight aria-label="to" className="size-3.5 shrink-0" style={{ color: paint.color }} />
        <TgtIcon aria-hidden className="size-3.5 shrink-0" style={{ color: KIND_COLOR[tgtKind] }} />
        <span className="truncate">{ev.target}</span>
      </span>
      {ev.label && <span className="mt-1 block truncate text-[12px] text-[var(--ink-2)]">{ev.label}</span>}
      {ev.status === "error" && (
        <span className="mt-1 flex items-center gap-1 text-[12px] text-[var(--danger)]">
          <AlertTriangle aria-hidden className="size-3 shrink-0" />
          <span className="truncate">{typeof ev.payload?.error === "string" ? ev.payload.error : "Error"}</span>
        </span>
      )}
    </button>
  )
})
