"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { toast } from "sonner"
import { ArrowRight, Check, Copy, PanelRightClose, PanelRightOpen, X } from "lucide-react"
import { eventPaint, detectParticipantKind, type TraceEvent } from "@/lib/types"
import { formatDuration } from "@/lib/api"
import { useMediaQuery } from "@/lib/hooks"
import { useLayout, DETAIL_SIZE } from "@/lib/store"
import { cn } from "@/lib/utils"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { ResizeHandle } from "@/components/layout/resize-handle"
import { JsonView, formatJson } from "@/components/ui/json-view"
import { PARTICIPANT_ICON, KIND_COLOR } from "./participants"
import { EventBadge } from "./event-badge"
import { clockTimeMs } from "./format"

interface Props {
  event: TraceEvent | null
  /** The event's index in the run (all events, filters ignored) and the run's size: "6 / 8". */
  index: number
  total: number
  onClose: () => void
  /** Overlay only: where focus goes when the overlay closes itself (the diagram canvas). */
  returnFocus?: () => void
  /**
   * - panel: the docked, resizable, collapsible side panel (xl and up);
   * - overlay: a non-modal panel over the right of the diagram (md to xl), below
   *   the run header and filter row and above the transport bar; the parent
   *   must be `relative`. Focus stays where it is, so the diagram keeps driving the selection;
   * - sheet: a modal full-height sheet (phones).
   */
  variant: "panel" | "overlay" | "sheet"
}

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
const ICON_BUTTON = cn(
  "grid size-7 place-items-center rounded-[var(--radius-control)] text-[var(--ink-2)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink)]",
  FOCUS
)

export function EventDetailPanel({ event, index, total, onClose, returnFocus, variant }: Props) {
  const { detailCollapsed, detailWidth, toggleDetail, setDetailWidth } = useLayout()
  const [dragging, setDragging] = useState(false)
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)")
  const content = event ? <EventBody event={event} index={index} total={total} /> : <EmptyDetail />

  if (variant === "sheet") {
    return (
      <Sheet open={!!event} onOpenChange={(o) => !o && onClose()}>
        <SheetContent side="right" className="w-full gap-0 border-[var(--line)] bg-[var(--surface-1)] p-0 sm:max-w-md">
          <SheetHeader className="border-b border-[var(--line)] px-4 py-3">
            <SheetTitle className="text-sm text-[var(--ink)]">Inspector</SheetTitle>
            <SheetDescription className="sr-only">Details and payload of the selected event.</SheetDescription>
          </SheetHeader>
          <div className="at-scroll flex-1 overflow-y-auto">{content}</div>
        </SheetContent>
      </Sheet>
    )
  }

  if (variant === "overlay") {
    const closeOverlay = () => {
      onClose()
      returnFocus?.()
    }
    return (
      <AnimatePresence>
        {event && (
          <motion.aside
            key="inspector"
            aria-label="Inspector"
            initial={reducedMotion ? { opacity: 0 } : { opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, x: 24 }}
            transition={{ duration: reducedMotion ? 0.12 : 0.18, ease: "easeOut" }}
            // Esc from inside the panel closes it; Esc elsewhere (the search
            // field, the diagram) belongs to that control.
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation()
                closeOverlay()
              }
            }}
            className="absolute inset-y-0 right-0 z-20 flex w-[min(24rem,calc(100%-3rem))] flex-col border-l border-[var(--line)] bg-[var(--surface-1)]"
            style={{ boxShadow: "var(--shadow-overlay)" }}
          >
            <PanelHeader>
              <button type="button" className={ICON_BUTTON} onClick={closeOverlay} aria-label="Close inspector" title="Close">
                <X aria-hidden className="size-4" />
              </button>
            </PanelHeader>
            <div className="at-scroll flex-1 overflow-y-auto">{content}</div>
          </motion.aside>
        )}
      </AnimatePresence>
    )
  }

  // docked side panel, collapsed to a rail
  if (detailCollapsed) {
    return (
      <aside
        aria-label="Inspector"
        className="relative hidden shrink-0 flex-col items-center gap-2 border-l border-[var(--line)] bg-[var(--surface-1)] py-2 xl:flex"
        style={{ width: DETAIL_SIZE.rail }}
      >
        <button type="button" className={ICON_BUTTON} onClick={toggleDetail} aria-label="Expand inspector" title="Expand inspector">
          <PanelRightOpen aria-hidden className="size-4" />
        </button>
        <span className="mt-1 text-[11px] text-[var(--ink-2)] [writing-mode:vertical-rl]">Inspector</span>
      </aside>
    )
  }

  // docked side panel, expanded and resizable
  return (
    <aside
      aria-label="Inspector"
      className={cn(
        "relative hidden shrink-0 flex-col border-l border-[var(--line)] bg-[var(--surface-1)] xl:flex",
        dragging ? "" : "transition-[width] duration-200 ease-out"
      )}
      style={{ width: detailWidth }}
    >
      <ResizeHandle
        width={detailWidth}
        setWidth={setDetailWidth}
        edge="left"
        onDragStart={() => setDragging(true)}
        onDragEnd={() => setDragging(false)}
      />
      <PanelHeader>
        {event && (
          <button type="button" className={ICON_BUTTON} onClick={onClose} aria-label="Clear selection" title="Clear selection">
            <X aria-hidden className="size-4" />
          </button>
        )}
        <button type="button" className={ICON_BUTTON} onClick={toggleDetail} aria-label="Collapse inspector" title="Collapse inspector">
          <PanelRightClose aria-hidden className="size-4" />
        </button>
      </PanelHeader>
      <div className="at-scroll min-h-0 flex-1 overflow-y-auto">{content}</div>
    </aside>
  )
}

function PanelHeader({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-11 shrink-0 items-center justify-between border-b border-[var(--line)] pr-2 pl-4">
      <h2 className="text-[13px] font-semibold text-[var(--ink)]">Inspector</h2>
      <div className="flex items-center gap-1">{children}</div>
    </div>
  )
}

function EmptyDetail() {
  return (
    <div className="flex h-full flex-col items-center justify-center p-6 text-center">
      <div className="mb-3 grid size-11 place-items-center rounded-full border border-dashed border-[var(--line-strong)]">
        <ArrowRight aria-hidden className="size-5 text-[var(--ink-2)]" />
      </div>
      <p className="text-sm text-[var(--ink-2)]">Select an arrow to inspect its payload.</p>
    </div>
  )
}

function EventBody({ event, index, total }: { event: TraceEvent; index: number; total: number }) {
  const paint = eventPaint(event.type, event.status === "error")
  const srcKind = detectParticipantKind(event.source)
  const tgtKind = detectParticipantKind(event.target)
  const SrcIcon = PARTICIPANT_ICON[srcKind]
  const TgtIcon = PARTICIPANT_ICON[tgtKind]
  const status = event.status === "error" ? "Error" : event.status ? event.status[0].toUpperCase() + event.status.slice(1) : "—"

  return (
    <div className="space-y-4 p-4">
      <div className="space-y-2">
        <EventBadge type={event.type} status={event.status} />
        <h3 className="text-sm leading-snug font-semibold break-words text-[var(--ink)]">{event.label || paint.label}</h3>
        <p className="flex min-w-0 items-center gap-1.5 font-mono text-[12px] text-[var(--ink)]">
          <SrcIcon aria-hidden className="size-3.5 shrink-0" style={{ color: KIND_COLOR[srcKind] }} />
          <span className="truncate">{event.source}</span>
          <ArrowRight aria-label="to" className="size-3.5 shrink-0" style={{ color: paint.color }} />
          <TgtIcon aria-hidden className="size-3.5 shrink-0" style={{ color: KIND_COLOR[tgtKind] }} />
          <span className="truncate">{event.target}</span>
        </p>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-y border-[var(--line)] py-3 text-[12px]">
        <Field label="Time">{clockTimeMs(event.timestamp) || "—"}</Field>
        <Field label="Duration">{formatDuration(event.durationMs)}</Field>
        <Field label="Status">
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="size-1.5 rounded-full"
              style={{ background: event.status === "error" ? "var(--st-failed)" : "var(--st-ok)" }}
            />
            {status}
          </span>
        </Field>
        <Field label="Position">
          {index + 1} / {total}
        </Field>
      </dl>

      <section aria-label="Payload" className="space-y-1.5">
        <div className="flex items-center justify-between">
          <h4 className="text-[12px] font-semibold text-[var(--ink-2)]">Payload</h4>
          <CopyJson key={event.id} value={event.payload} />
        </div>
        <JsonView
          key={event.id}
          value={event.payload}
          className="at-scroll max-h-[min(28rem,55vh)] overflow-auto rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--surface-1)] p-3"
        />
      </section>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-[var(--ink-2)]">{label}</dt>
      <dd className="min-w-0 font-mono text-[var(--ink)] tabular-nums">{children}</dd>
    </>
  )
}

function CopyJson({ value }: { value: unknown }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])
  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error("no clipboard")
      await navigator.clipboard.writeText(formatJson(value))
      toast.success("Payload copied")
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error("Couldn't copy the payload. Select the JSON and copy it by hand.")
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-[var(--radius-control)] border border-[var(--line)] px-2 text-[11px] text-[var(--ink)] transition-colors hover:bg-[var(--surface-2)]",
        FOCUS
      )}
    >
      {copied ? <Check aria-hidden className="size-3" /> : <Copy aria-hidden className="size-3" />}
      Copy JSON
    </button>
  )
}
