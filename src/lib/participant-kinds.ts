import type { Participant, RunShape } from "@/lib/types"

export type ParticipantKind = Participant["kind"]

/** What the classifier reads of an event: who sent it, to whom, and its type. */
export interface EventLink {
  source: string
  target: string
  type: string
}

/** How one name is used across a run's events. */
interface Usage {
  /** Types of the events it sends. */
  sends: Set<string>
  /** Types of the events it receives. */
  receives: Set<string>
  /** It receives a handoff from the user: the agent the user talks to. */
  fromUser: boolean
  /** It receives a handoff from anyone else: a delegated sub-agent. */
  delegated: boolean
}

/** Sending one of these makes a participant an agent: it calls models and tools, delegates, answers. */
const AGENT_SENDS = ["llm_call", "tool_call", "handoff", "final_answer"]
/** So does receiving one: the results and errors of what it called come back to it. */
const AGENT_RECEIVES = ["tool_result", "error"]

const isUser = (name: string) => name.toLowerCase() === "user"

/**
 * A participant's kind from its name alone: the last resort, for a name the
 * events say nothing about. It mistypes a model whose name has no keyword
 * ("zai.glm-5" → tool) and a tool whose name happens to hold one
 * ("iam_resolve_user_scope" → user), so `classifyParticipants` asks the events first.
 */
export function detectParticipantKind(name: string): ParticipantKind {
  const n = name.toLowerCase()
  if (n === "user" || n.includes("user")) return "user"
  if (n.includes("orchestrator") || n.includes("agent") || n.includes("main")) return "orchestrator"
  if (n === "llm" || n.includes("llm") || n.includes("gpt") || n.includes("claude") || n.includes("model")) return "llm"
  if (n.includes("sub-agent") || n.includes("subagent") || n.includes("research") || n.includes("assistant")) return "subagent"
  return "tool"
}

function kindFromUsage(name: string, u: Usage): ParticipantKind {
  // Stable identities, by name.
  if (isUser(name)) return "user"
  if (name.toLowerCase().includes("orchestrator")) return "orchestrator"
  // What the events say, strongest signal first.
  if (u.receives.has("llm_call")) return "llm"
  if (u.fromUser) return "orchestrator"
  // A sub-agent, even though it reports back with a tool_result and gets its own tools' results.
  if (u.delegated) return "subagent"
  if (u.receives.has("tool_call") || u.sends.has("tool_result")) return "tool"
  // Any other agent: a renamed orchestrator (the user, typed above, also receives errors).
  if (AGENT_SENDS.some((type) => u.sends.has(type)) || AGENT_RECEIVES.some((type) => u.receives.has(type))) {
    return "orchestrator"
  }
  // An error comes from a tool, or from a model whose first call failed (the
  // SDK draws that as model → agent): only the name tells those two apart.
  if (u.sends.has("error")) return detectParticipantKind(name) === "llm" ? "llm" : "tool"
  return detectParticipantKind(name)
}

/**
 * Each participant's kind, from how the events use its name: the target of an
 * `llm_call` is a model; the agent the user hands off to is the orchestrator,
 * any other handoff target a sub-agent; the target of a `tool_call` or the
 * source of a `tool_result` or `error` is a tool; whoever else calls, delegates,
 * answers or receives a `tool_result` or `error` is an agent, the orchestrator.
 * "User" and names holding "orchestrator" are typed by name; the name heuristic
 * is the last resort. Keyed by name, in first-seen order (each event's source,
 * then its target).
 */
export function classifyParticipants(events: Iterable<EventLink>): Map<string, ParticipantKind> {
  const usages = new Map<string, Usage>()
  const usageOf = (name: string) => {
    let u = usages.get(name)
    if (!u) usages.set(name, (u = { sends: new Set(), receives: new Set(), fromUser: false, delegated: false }))
    return u
  }
  for (const ev of events) {
    usageOf(ev.source).sends.add(ev.type)
    const target = usageOf(ev.target)
    target.receives.add(ev.type)
    if (ev.type === "handoff" && ev.target !== ev.source) {
      if (isUser(ev.source)) target.fromUser = true
      else target.delegated = true
    }
  }
  return new Map(Array.from(usages, ([name, u]) => [name, kindFromUsage(name, u)]))
}

const participant = (name: string, kind: ParticipantKind): Participant => ({ id: name, name, kind, icon: kind })

/** A run's participants, in first-seen order, typed by `classifyParticipants`. */
export function extractParticipants(events: Iterable<EventLink>): Participant[] {
  return Array.from(classifyParticipants(events), ([name, kind]) => participant(name, kind))
}

/**
 * The participants of a run's compact shape (`GET /api/runs/recent`: lane
 * names, and events as lane indexes `{s, t, type}`), in lane order, typed the
 * same way as a full event list. An event pointing past the lanes is ignored.
 */
export function shapeParticipants(shape: RunShape): Participant[] {
  const lanes = shape.participants
  const links: EventLink[] = []
  for (const e of shape.events) {
    const source = lanes[e.s]
    const target = lanes[e.t]
    if (source !== undefined && target !== undefined) links.push({ source, target, type: e.type })
  }
  const kinds = classifyParticipants(links)
  return lanes.map((name) => participant(name, kinds.get(name) ?? detectParticipantKind(name)))
}

/** A name's kind in a run's participant list; a name missing from it is typed by its name alone. */
export function kindLookup(participants: readonly Participant[]): (name: string) => ParticipantKind {
  const kinds = new Map(participants.map((p) => [p.name, p.kind]))
  return (name) => kinds.get(name) ?? detectParticipantKind(name)
}
