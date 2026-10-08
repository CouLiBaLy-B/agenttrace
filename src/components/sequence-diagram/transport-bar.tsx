"use client"

import { memo, useRef, type KeyboardEvent, type PointerEvent } from "react"
import { Pause, Play } from "lucide-react"
import { eventPaint, type TraceEvent } from "@/lib/types"
import { cn } from "@/lib/utils"
import { clockTime } from "./format"
import { indexAtPosition } from "./scrubber"

/** Replay speed; 0 = instant (jump to the end, no animation). */
export type ReplaySpeed = 0.5 | 1 | 2 | 0

const SPEEDS: { value: ReplaySpeed; label: string }[] = [
  { value: 0.5, label: "0.5×" },
  { value: 1, label: "1×" },
  { value: 2, label: "2×" },
  { value: 0, label: "instant" },
]

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"

interface Props {
  events: TraceEvent[]
  /** Each event's place on the track, 0…1 (scrubberPositions). */
  positions: number[]
  /** The playhead's event index (the last event outside replay). */
  currentIndex: number
  isReplay: boolean
  isPlaying: boolean
  speed: ReplaySpeed
  /** The run is still running. */
  live: boolean
  onTogglePlay: () => void
  onSeek: (index: number) => void
  onSpeed: (speed: ReplaySpeed) => void
  /** Leave replay: "Back to live" on a running run, "Exit replay" otherwise. */
  onBackToLive: () => void
}

/** The run view's bottom bar: play / pause, speed, a scrubber with one tick per
 * event at its relative time, and a draggable playhead. Playing or seeking
 * enters replay. */
export function TransportBar({
  events,
  positions,
  currentIndex,
  isReplay,
  isPlaying,
  speed,
  live,
  onTogglePlay,
  onSeek,
  onSpeed,
  onBackToLive,
}: Props) {
  const railRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const total = events.length
  const at = Math.max(0, Math.min(currentIndex, total - 1))
  const current = events[at]

  const seekAt = (clientX: number) => {
    const rail = railRef.current
    if (!rail) return
    const rect = rail.getBoundingClientRect()
    const index = indexAtPosition(positions, rect.width > 0 ? (clientX - rect.left) / rect.width : 0)
    if (index !== currentIndex || !isReplay) onSeek(index)
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragging.current = true
    // The playhead takes focus so the keyboard can carry on from here.
    e.currentTarget.querySelector<HTMLElement>('[role="slider"]')?.focus({ preventScroll: true })
    seekAt(e.clientX)
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) seekAt(e.clientX)
  }
  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    dragging.current = false
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const page = Math.max(1, Math.round(total / 10))
    const next =
      e.key === "ArrowLeft" || e.key === "ArrowDown" ? at - 1
      : e.key === "ArrowRight" || e.key === "ArrowUp" ? at + 1
      : e.key === "PageDown" ? at - page
      : e.key === "PageUp" ? at + page
      : e.key === "Home" ? 0
      : e.key === "End" ? total - 1
      : null
    if (next === null) return
    e.preventDefault()
    onSeek(Math.max(0, Math.min(next, total - 1)))
  }

  return (
    <div
      role="group"
      aria-label="Replay"
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-[var(--line)] bg-[var(--surface-1)] px-3 py-2"
    >
      <button
        type="button"
        onClick={onTogglePlay}
        aria-label={isPlaying ? "Pause replay" : "Play replay"}
        title={isPlaying ? "Pause" : "Play"}
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-[var(--radius-control)] bg-[var(--action)] text-[var(--on-action)] transition-opacity hover:opacity-90",
          FOCUS
        )}
      >
        {isPlaying ? <Pause aria-hidden className="size-4" /> : <Play aria-hidden className="ml-0.5 size-4" />}
      </button>

      <SpeedControl speed={speed} onSpeed={onSpeed} />

      {/* The scrubber: a full row on phones, the remaining width from sm. */}
      <div
        className="relative order-last h-8 w-full min-w-0 cursor-pointer touch-none select-none px-1.5 sm:order-none sm:w-auto sm:flex-1"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={() => (dragging.current = false)}
      >
        <div ref={railRef} className="relative h-full">
          <div aria-hidden className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[var(--line-strong)]" />
          <Ticks events={events} positions={positions} />
          {isReplay && (
            // Events past the playhead fade back (a veil, so dragging doesn't re-render every tick).
            <div
              aria-hidden
              className="absolute inset-y-0 right-0"
              style={{
                left: `calc(${(positions[at] ?? 1) * 100}% + 2px)`,
                background: "color-mix(in srgb, var(--surface-1) 60%, transparent)",
              }}
            />
          )}
          <div
            role="slider"
            tabIndex={0}
            aria-label="Replay position"
            aria-valuemin={0}
            aria-valuemax={total - 1}
            aria-valuenow={at}
            aria-valuetext={`Event ${at + 1} of ${total}${current ? `, ${eventPaint(current.type, current.status === "error").label}` : ""}`}
            onKeyDown={onKeyDown}
            className={cn("absolute top-0 bottom-0 w-3 -translate-x-1/2 rounded-[var(--radius-control)]", FOCUS)}
            style={{ left: `${(positions[at] ?? 1) * 100}%` }}
          >
            <span aria-hidden className="absolute top-0.5 bottom-0.5 left-1/2 w-0.5 -translate-x-1/2 rounded-full bg-[var(--ink)]" />
            <span
              aria-hidden
              className="absolute top-0 left-1/2 size-2.5 -translate-x-1/2 rounded-full border-2 border-[var(--ink)] bg-[var(--surface-1)]"
            />
          </div>
        </div>
      </div>

      <span className="shrink-0 font-mono text-[11px] text-[var(--ink-2)] tabular-nums">
        {at + 1} / {total}
        {current && (
          <span className="hidden md:inline">
            {" · "}
            <span className="at-clock">{clockTime(current.timestamp)}</span>
          </span>
        )}
      </span>

      {isReplay && (
        <button
          type="button"
          onClick={onBackToLive}
          className={cn(
            "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-[var(--line-strong)] px-3 text-[12px] text-[var(--ink)] transition-colors hover:bg-[var(--surface-2)]",
            FOCUS
          )}
        >
          {live && (
            <span aria-hidden className="relative flex size-2">
              <span className="at-pulse-ring absolute inline-flex size-full rounded-full" style={{ background: "var(--st-running)" }} />
              <span className="relative inline-flex size-2 rounded-full" style={{ background: "var(--st-running)" }} />
            </span>
          )}
          {live ? "Back to live" : "Exit replay"}
        </button>
      )}
    </div>
  )
}

/** One 2 px tick per event at its position, in its event colour. */
const Ticks = memo(function Ticks({ events, positions }: { events: TraceEvent[]; positions: number[] }) {
  return (
    <div aria-hidden className="absolute inset-0">
      {events.map((ev, i) => (
        <span
          key={ev.id}
          className="absolute top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            left: `${(positions[i] ?? 0) * 100}%`,
            background: eventPaint(ev.type, ev.status === "error").color,
          }}
        />
      ))}
    </div>
  )
})

/** Replay speed as a radio group: one tab stop (the checked speed); ←/→ (↑/↓) move and select. */
function SpeedControl({ speed, onSpeed }: { speed: ReplaySpeed; onSpeed: (speed: ReplaySpeed) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0
    if (!step) return
    e.preventDefault()
    const at = SPEEDS.findIndex((s) => s.value === speed)
    const next = (at + step + SPEEDS.length) % SPEEDS.length
    onSpeed(SPEEDS[next].value)
    refs.current[next]?.focus()
  }
  return (
    <div
      role="radiogroup"
      aria-label="Replay speed"
      onKeyDown={onKeyDown}
      className="flex shrink-0 items-center rounded-[var(--radius-control)] border border-[var(--line)] p-0.5"
    >
      {SPEEDS.map((s, i) => {
        const on = s.value === speed
        return (
          <button
            key={s.value}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onSpeed(s.value)}
            className={cn(
              "h-6 rounded-[calc(var(--radius-control)-2px)] px-2 font-mono text-[11px] tabular-nums transition-colors",
              on ? "bg-[var(--surface-2)] text-[var(--ink)]" : "text-[var(--ink-2)] hover:text-[var(--ink)]",
              FOCUS
            )}
            style={on ? { boxShadow: "inset 0 0 0 1px var(--line-strong)" } : undefined}
          >
            {s.label}
          </button>
        )
      })}
    </div>
  )
}
