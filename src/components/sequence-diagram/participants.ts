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
//
// Kind is inferred from HOW each name is used across events (its role in the
// event types that reference it), not from substrings in the name. Name-based
// guessing (detectParticipantKind) is only a last resort: it mistypes a model
// whose name lacks a keyword (e.g. "zai.glm-5" → tool) and a tool whose name
// happens to contain one (e.g. "iam_resolve_user_scope" → user). The event
// stream already says what each participant is: the target of an `llm_call`
// is the model, the target of a `tool_call` is a tool, a `handoff` target
// (that isn't the user) is a sub-agent.
export function extractParticipants(events: TraceEvent[]): Participant[] {
  const order: string[] = []
  const roles = new Map<string, Set<string>>()
  const note = (name: string, role: string) => {
    let set = roles.get(name)
    if (!set) {
      set = new Set()
      roles.set(name, set)
      order.push(name)
    }
    set.add(role)
  }
  for (const ev of events) {
    note(ev.source, `src:${ev.type}`)
    note(ev.target, `tgt:${ev.type}`)
  }
  return order.map((name) => {
    const kind = classifyParticipant(name, roles.get(name)!)
    return { id: name, name, kind, icon: kind }
  })
}

function classifyParticipant(name: string, roles: Set<string>): Participant["kind"] {
  const n = name.toLowerCase()
  // Stable identities by exact/anchored name first.
  if (n === "user") return "user"
  if (n.includes("orchestrator")) return "orchestrator"
  // Context signals from the event stream (robust to arbitrary names).
  if (roles.has("tgt:llm_call")) return "llm"
  // A handoff target that isn't the user is a delegated sub-agent. (Handoff is
  // also User→Orchestrator and Orchestrator→User, both handled by name above.)
  if (roles.has("tgt:handoff")) return "subagent"
  // Tool side of a tool exchange (call target / result or error source).
  if (roles.has("tgt:tool_call") || roles.has("src:tool_result") || roles.has("src:error"))
    return "tool"
  // Last resort: name heuristics.
  return detectParticipantKind(name)
}

// Color per participant kind (for lifeline tints / icons)
export const KIND_COLOR: Record<Participant["kind"], string> = {
  user: "#f472b6",
  orchestrator: "#34d399",
  llm: "#22d3ee",
  tool: "#a78bfa",
  subagent: "#fbbf24",
}
