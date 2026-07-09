// Shared types for AgentTrace

export type EventType =
  | "llm_call"
  | "tool_call"
  | "tool_result"
  | "handoff"
  | "error"
  | "final_answer"

export type RunStatus = "running" | "completed" | "failed"

export type EventStatus = "ok" | "error" | "pending"

export interface TraceEvent {
  id: string
  runId: string
  timestamp: string
  seq: number
  source: string
  target: string
  type: EventType
  label?: string | null
  payload: any
  durationMs?: number | null
  status: EventStatus
}

export interface Participant {
  id: string
  name: string
  kind: "user" | "orchestrator" | "llm" | "tool" | "subagent"
  icon: string
}

// Color mapping by event type (used by both client and is referenced in styling)
export const EVENT_COLORS: Record<EventType, { color: string; label: string }> = {
  llm_call: { color: "#22d3ee", label: "LLM Call" }, // cyan
  tool_call: { color: "#a78bfa", label: "Tool Call" }, // violet
  tool_result: { color: "#34d399", label: "Tool Result" }, // emerald
  handoff: { color: "#fbbf24", label: "Handoff" }, // amber
  error: { color: "#f87171", label: "Error" }, // red
  final_answer: { color: "#f472b6", label: "Final Answer" }, // pink
}

// Detect participant kind from a name/id
export function detectParticipantKind(name: string): Participant["kind"] {
  const n = name.toLowerCase()
  if (n === "user" || n.includes("user")) return "user"
  if (n.includes("orchestrator") || n.includes("agent") || n.includes("main")) return "orchestrator"
  if (n === "llm" || n.includes("llm") || n.includes("gpt") || n.includes("claude") || n.includes("model")) return "llm"
  if (n.includes("sub-agent") || n.includes("subagent") || n.includes("research") || n.includes("assistant")) return "subagent"
  return "tool"
}

export const PARTICIPANT_ICONS: Record<Participant["kind"], string> = {
  user: "User",
  orchestrator: "Cpu",
  llm: "Brain",
  tool: "Wrench",
  subagent: "Bot",
}
