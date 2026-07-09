"use client"

import { motion } from "framer-motion"
import { TraceEvent, EVENT_COLORS } from "@/lib/types"
import { Participant } from "@/lib/types"
import { PARTICIPANT_ICON, KIND_COLOR } from "./participants"
import { ArrowRight, AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"

interface Props {
  events: TraceEvent[]
  participants: Participant[]
  selectedId: string | null
  onSelect: (id: string) => void
}

export function StackedTimeline({ events, participants: _participants, selectedId, onSelect }: Props) {
  return (
    <div className="at-graticule p-3 space-y-2 at-scroll overflow-y-auto h-full">
      {events.map((ev, i) => {
        const meta = EVENT_COLORS[ev.type as keyof typeof EVENT_COLORS] || { color: "#888", label: ev.type }
        const color = ev.status === "error" ? "#f87171" : meta.color
        const selected = ev.id === selectedId
        const SrcIcon = PARTICIPANT_ICON[kindOf(ev.source)]
        const TgtIcon = PARTICIPANT_ICON[kindOf(ev.target)]
        return (
          <motion.button
            key={ev.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: Math.min(i * 0.02, 0.3) }}
            onClick={() => onSelect(ev.id)}
            className={cn(
              "w-full text-left rounded-md border bg-card/70 px-3 py-2.5 transition-colors",
              selected ? "border-primary/60 bg-primary/5" : "border-border hover:border-primary/30"
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="font-mono text-[10px] text-muted-foreground tabular-nums shrink-0">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span
                  className="rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider shrink-0"
                  style={{ background: `${color}22`, color }}
                >
                  {ev.type.replace("_", " ")}
                </span>
              </div>
              {ev.durationMs != null && (
                <span className="font-mono text-[10px] text-muted-foreground shrink-0">{ev.durationMs}ms</span>
              )}
            </div>
            <div className="mt-1.5 flex items-center gap-2 text-sm">
              <span className="flex items-center gap-1 min-w-0">
                <SrcIcon className="h-3.5 w-3.5 shrink-0" style={{ color: KIND_COLOR[kindOf(ev.source)] }} />
                <span className="truncate font-mono text-xs">{ev.source}</span>
              </span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0" style={{ color }} />
              <span className="flex items-center gap-1 min-w-0">
                <TgtIcon className="h-3.5 w-3.5 shrink-0" style={{ color: KIND_COLOR[kindOf(ev.target)] }} />
                <span className="truncate font-mono text-xs">{ev.target}</span>
              </span>
            </div>
            {ev.label && (
              <p className="mt-1 text-xs text-muted-foreground truncate">{ev.label}</p>
            )}
            {ev.status === "error" && (
              <p className="mt-1 flex items-center gap-1 text-[11px] text-red-400">
                <AlertTriangle className="h-3 w-3" />
                {typeof ev.payload?.error === "string" ? ev.payload.error : "error"}
              </p>
            )}
          </motion.button>
        )
      })}
    </div>
  )
}

function kindOf(name: string): Participant["kind"] {
  const n = name.toLowerCase()
  if (n === "user" || n.includes("user")) return "user"
  if (n.includes("orchestrator") || n.includes("agent") || n.includes("main")) return "orchestrator"
  if (n === "llm" || n.includes("llm") || n.includes("gpt") || n.includes("claude") || n.includes("model")) return "llm"
  if (n.includes("sub-agent") || n.includes("subagent") || n.includes("research") || n.includes("assistant")) return "subagent"
  return "tool"
}
