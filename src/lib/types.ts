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

// Colour per event type. Values are CSS variables from the active theme
// (src/app/themes.css): `color` for strokes and fills, `text` for text (it
// meets 4.5:1 on the panel surface in every theme). Because they are
// variables, never append a hex alpha — use color-mix(in oklab, <color> N%, transparent).
export const EVENT_COLORS: Record<EventType, { color: string; text: string; label: string }> = {
  llm_call: { color: "var(--ev-llm)", text: "var(--ev-llm-text)", label: "LLM call" },
  tool_call: { color: "var(--ev-tool)", text: "var(--ev-tool-text)", label: "Tool call" },
  tool_result: { color: "var(--ev-result)", text: "var(--ev-result-text)", label: "Tool result" },
  handoff: { color: "var(--ev-handoff)", text: "var(--ev-handoff-text)", label: "Handoff" },
  error: { color: "var(--ev-error)", text: "var(--ev-error-text)", label: "Error" },
  final_answer: { color: "var(--ev-answer)", text: "var(--ev-answer-text)", label: "Final answer" },
}

// Label and colour per run status (dots, rings, borders: --st-* reach 3:1, not
// the 4.5:1 text needs, so status text stays in --ink).
export const RUN_STATUS: Record<RunStatus, { label: string; color: string }> = {
  running: { label: "Running", color: "var(--st-running)" },
  completed: { label: "Completed", color: "var(--st-ok)" },
  failed: { label: "Failed", color: "var(--st-failed)" },
}

const UNKNOWN_EVENT = { color: "var(--ink-3)", text: "var(--ink-2)" }

/** An event's colours and label: an error status turns any type to the error
 * colours; a type this build doesn't know is drawn in tertiary ink. */
export function eventPaint(type: string, isError: boolean): { color: string; text: string; label: string } {
  const meta = EVENT_COLORS[type as EventType] ?? { ...UNKNOWN_EVENT, label: type }
  return isError ? { ...meta, color: EVENT_COLORS.error.color, text: EVENT_COLORS.error.text } : meta
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
