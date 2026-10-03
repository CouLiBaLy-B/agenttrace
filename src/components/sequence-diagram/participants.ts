import { TraceEvent, Participant, detectParticipantKind } from "@/lib/types"
import { User, Cpu, BrainCircuit, Wrench, Bot, type LucideIcon } from "lucide-react"

export const PARTICIPANT_ICON: Record<Participant["kind"], LucideIcon> = {
  user: User,
  orchestrator: Cpu,
  llm: BrainCircuit,
  tool: Wrench,
  subagent: Bot,
}

// Extract participants from an event stream, in first-seen order.
export function extractParticipants(events: TraceEvent[]): Participant[] {
  const seen = new Map<string, Participant>()
  for (const ev of events) {
    for (const name of [ev.source, ev.target]) {
      if (!seen.has(name)) {
        const kind = detectParticipantKind(name)
        seen.set(name, { id: name, name, kind, icon: kind })
      }
    }
  }
  return Array.from(seen.values())
}

// Color per participant kind (for lifeline tints / icons). CSS variables from
// the active theme — build translucent variants with color-mix, not a hex alpha.
export const KIND_COLOR: Record<Participant["kind"], string> = {
  user: "var(--kind-user)",
  orchestrator: "var(--kind-orchestrator)",
  llm: "var(--kind-llm)",
  tool: "var(--kind-tool)",
  subagent: "var(--kind-subagent)",
}
