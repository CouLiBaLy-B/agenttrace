"use client"

import { TraceEvent, EVENT_COLORS } from "@/lib/types"
import { Participant } from "@/lib/types"
import { PARTICIPANT_ICON, KIND_COLOR } from "./participants"
import { useState } from "react"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ArrowRight, Clock, X, PanelRightClose, PanelRightOpen } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ResizeHandle } from "@/components/layout/resize-handle"
import { useLayout, DETAIL_SIZE } from "@/lib/store"
import { cn } from "@/lib/utils"

interface Props {
  event: TraceEvent | null
  participants: Participant[]
  onClose: () => void
  // desktop side panel vs mobile sheet
  variant: "panel" | "sheet"
}

export function EventDetailPanel({ event, onClose, variant }: Props) {
  const { detailCollapsed, detailWidth, toggleDetail, setDetailWidth } = useLayout()
  const [dragging, setDragging] = useState(false)
  const content = event ? <EventBody event={event} /> : <EmptyDetail />

  if (variant === "sheet") {
    return (
      <Sheet open={!!event} onOpenChange={(o) => !o && onClose()}>
        <SheetContent side="right" className="w-full sm:max-w-md p-0">
          <SheetHeader className="px-4 py-3 border-b border-border">
            <SheetTitle className="font-mono text-sm">Event payload</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto at-scroll">{content}</div>
        </SheetContent>
      </Sheet>
    )
  }

  // desktop side panel — collapsed to a rail
  if (detailCollapsed) {
    return (
      <aside
        className="relative hidden xl:flex shrink-0 border-l border-border bg-card/40 flex-col items-center gap-2 py-2"
        style={{ width: DETAIL_SIZE.rail }}
      >
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          onClick={toggleDetail}
          title="Expand panel"
        >
          <PanelRightOpen className="h-4 w-4" />
        </Button>
        <span className="mt-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground [writing-mode:vertical-rl]">
          event payload
        </span>
      </aside>
    )
  }

  // desktop side panel — expanded, resizable
  return (
    <aside
      className={cn(
        "relative hidden xl:flex shrink-0 border-l border-border bg-card/40 flex-col",
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
      <div className="flex items-center justify-between px-4 h-12 border-b border-border">
        <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          event payload
        </span>
        <div className="flex items-center gap-1">
          {event && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} title="Clear selection">
              <X className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={toggleDetail}
            title="Collapse panel"
          >
            <PanelRightClose className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <ScrollArea className="flex-1">{content}</ScrollArea>
    </aside>
  )
}

function EmptyDetail() {
  return (
    <div className="h-full flex flex-col items-center justify-center p-6 text-center">
      <div className="h-12 w-12 rounded-full border border-dashed border-border flex items-center justify-center mb-3">
        <ArrowRight className="h-5 w-5 text-muted-foreground" />
      </div>
      <p className="text-sm text-muted-foreground">Select an arrow to inspect its payload.</p>
    </div>
  )
}

function EventBody({ event }: { event: TraceEvent }) {
  const meta = EVENT_COLORS[event.type as keyof typeof EVENT_COLORS] || { color: "#888", label: event.type }
  const color = event.status === "error" ? "#f87171" : meta.color
  const SrcIcon = PARTICIPANT_ICON[kindOfLocal(event.source)]
  const TgtIcon = PARTICIPANT_ICON[kindOfLocal(event.target)]

  return (
    <div className="p-4 space-y-4">
      {/* header */}
      <div>
        <span
          className="inline-block rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest"
          style={{ background: `${color}22`, color }}
        >
          {event.type.replace("_", " ")}
        </span>
        {event.label && (
          <h3 className="mt-2 text-sm font-medium leading-snug">{event.label}</h3>
        )}
      </div>

      {/* source → target */}
      <div className="rounded-md border border-border bg-background/40 p-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="flex items-center gap-1.5 min-w-0">
            <SrcIcon className="h-4 w-4 shrink-0" style={{ color: KIND_COLOR[kindOfLocal(event.source)] }} />
            <span className="font-mono text-xs truncate">{event.source}</span>
          </span>
          <ArrowRight className="h-4 w-4 shrink-0" style={{ color }} />
          <span className="flex items-center gap-1.5 min-w-0">
            <TgtIcon className="h-4 w-4 shrink-0" style={{ color: KIND_COLOR[kindOfLocal(event.target)] }} />
            <span className="font-mono text-xs truncate">{event.target}</span>
          </span>
        </div>
      </div>

      {/* meta */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <Meta label="sequence" value={`#${event.seq}`} />
        <Meta label="status" value={event.status} accent={event.status === "error" ? "#f87171" : "#34d399"} />
        <Meta label="timestamp" value={new Date(event.timestamp).toLocaleTimeString()} />
        <Meta
          label="duration"
          value={event.durationMs != null ? `${event.durationMs}ms` : "—"}
          icon={<Clock className="h-3 w-3" />}
        />
      </div>

      {/* payload */}
      <div>
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">
          payload
        </p>
        <pre className="rounded-md border border-border bg-background/60 p-3 text-[11px] leading-relaxed font-mono overflow-x-auto at-scroll whitespace-pre-wrap break-words">
          {JSON.stringify(event.payload, null, 2)}
        </pre>
      </div>
    </div>
  )
}

function Meta({ label, value, accent, icon }: { label: string; value: string; accent?: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-background/40 px-3 py-2">
      <p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-mono text-xs flex items-center gap-1" style={accent ? { color: accent } : undefined}>
        {icon}
        {value}
      </p>
    </div>
  )
}

function kindOfLocal(name: string): Participant["kind"] {
  const n = name.toLowerCase()
  if (n === "user" || n.includes("user")) return "user"
  if (n.includes("orchestrator") || n.includes("agent") || n.includes("main")) return "orchestrator"
  if (n === "llm" || n.includes("llm") || n.includes("gpt") || n.includes("claude") || n.includes("model")) return "llm"
  if (n.includes("sub-agent") || n.includes("subagent") || n.includes("research") || n.includes("assistant")) return "subagent"
  return "tool"
}
