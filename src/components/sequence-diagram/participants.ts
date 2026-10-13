import type { Participant } from "@/lib/types"
import { User, Cpu, BrainCircuit, Wrench, Bot, type LucideIcon } from "lucide-react"

// A participant's kind comes from how the run's events use it
// (extractParticipants / shapeParticipants in src/lib/participant-kinds.ts).

export const PARTICIPANT_ICON: Record<Participant["kind"], LucideIcon> = {
  user: User,
  orchestrator: Cpu,
  llm: BrainCircuit,
  tool: Wrench,
  subagent: Bot,
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
