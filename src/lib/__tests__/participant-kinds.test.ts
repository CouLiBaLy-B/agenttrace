import { describe, expect, it } from "vitest"
import {
  classifyParticipants,
  detectParticipantKind,
  extractParticipants,
  kindLookup,
  shapeParticipants,
  type EventLink,
} from "@/lib/participant-kinds"
import type { EventType, RunShape } from "@/lib/types"

const ev = (source: string, target: string, type: EventType): EventLink => ({ source, target, type })
const kinds = (events: EventLink[]) => Object.fromEntries(classifyParticipants(events))

describe("classifyParticipants", () => {
  it("types a model by the llm_call it receives, not by its name", () => {
    // The name alone says tool: no keyword in "zai.glm-5".
    expect(detectParticipantKind("zai.glm-5")).toBe("tool")
    expect(kinds([ev("Orchestrator", "zai.glm-5", "llm_call")])["zai.glm-5"]).toBe("llm")
  })

  it("types a tool by the tool_call it receives, even with 'user' in its name", () => {
    expect(detectParticipantKind("iam_resolve_user_scope")).toBe("user")
    const k = kinds([
      ev("Orchestrator", "iam_resolve_user_scope", "tool_call"),
      ev("iam_resolve_user_scope", "Orchestrator", "tool_result"),
    ])
    expect(k["iam_resolve_user_scope"]).toBe("tool")
  })

  it("an error's source is a tool", () => {
    // Only the error mentions it, and its name says user.
    const k = kinds([ev("Orchestrator", "LLM", "llm_call"), ev("crm_user_sync", "Orchestrator", "error")])
    expect(k["crm_user_sync"]).toBe("tool")
  })

  it("a tool_result's source is a tool", () => {
    expect(kinds([ev("main_index", "Orchestrator", "tool_result")])["main_index"]).toBe("tool")
  })

  it("an error from a model that never answered stays a model", () => {
    // How the SDK reports a failed first LLM call: model → agent.
    expect(kinds([ev("gpt-4o", "Orchestrator", "error")])["gpt-4o"]).toBe("llm")
  })

  it("types User exactly, by name", () => {
    const k = kinds([ev("User", "Orchestrator", "handoff"), ev("Orchestrator", "user", "final_answer")])
    expect(k.User).toBe("user")
    expect(k.user).toBe("user")
  })

  it("types the orchestrator by name, whatever it receives", () => {
    const k = kinds([ev("researcher", "Orchestrator", "handoff"), ev("researcher", "Orchestrator", "tool_result")])
    expect(k.Orchestrator).toBe("orchestrator")
  })

  it("a handoff target other than the user is a sub-agent, though it reports back with a tool_result", () => {
    const k = kinds([
      ev("Orchestrator", "fact_checker", "handoff"),
      ev("fact_checker", "LLM", "llm_call"),
      ev("fact_checker", "web_search", "tool_call"),
      ev("web_search", "fact_checker", "tool_result"),
      ev("fact_checker", "Orchestrator", "tool_result"),
    ])
    expect(k).toEqual({ Orchestrator: "orchestrator", fact_checker: "subagent", LLM: "llm", web_search: "tool" })
  })

  it("the agent the user hands off to is the orchestrator, whatever its name", () => {
    const k = kinds([
      ev("User", "Support bot", "handoff"),
      ev("Support bot", "triage", "handoff"),
      ev("triage", "Support bot", "tool_result"),
    ])
    expect(k["Support bot"]).toBe("orchestrator")
    expect(k.triage).toBe("subagent")
  })

  it("an agent that calls models and tools is not a tool, even when it reports an error", () => {
    const k = kinds([
      ev("Support bot", "zai.glm-5", "llm_call"),
      ev("Support bot", "lookup_order", "tool_call"),
      ev("lookup_order", "Support bot", "tool_result"),
      ev("Support bot", "User", "error"),
    ])
    expect(k).toEqual({ "Support bot": "orchestrator", "zai.glm-5": "llm", lookup_order: "tool", User: "user" })
  })

  it("falls back to the name when the events say nothing", () => {
    // Receivers of a result or an answer only.
    expect(kinds([ev("web_search", "main", "tool_result")]).main).toBe("orchestrator")
    expect(kinds([ev("planner", "research_assistant", "final_answer")]).research_assistant).toBe("subagent")
    expect(kinds([ev("planner", "inbox", "final_answer")]).inbox).toBe("tool")
  })

  it("a handoff to itself is no delegation: the sender is an agent", () => {
    expect(kinds([ev("planner", "planner", "handoff")]).planner).toBe("orchestrator")
  })

  it("keeps first-seen order, source before target", () => {
    const names = [...classifyParticipants([ev("User", "Orchestrator", "handoff"), ev("Orchestrator", "LLM", "llm_call")]).keys()]
    expect(names).toEqual(["User", "Orchestrator", "LLM"])
  })
})

describe("extractParticipants", () => {
  it("returns typed participants in first-seen order", () => {
    expect(extractParticipants([ev("User", "Orchestrator", "handoff"), ev("Orchestrator", "zai.glm-5", "llm_call")])).toEqual([
      { id: "User", name: "User", kind: "user", icon: "user" },
      { id: "Orchestrator", name: "Orchestrator", kind: "orchestrator", icon: "orchestrator" },
      { id: "zai.glm-5", name: "zai.glm-5", kind: "llm", icon: "llm" },
    ])
  })
})

describe("shapeParticipants", () => {
  const shape: RunShape = {
    participants: ["User", "Orchestrator", "zai.glm-5", "iam_resolve_user_scope"],
    events: [
      { s: 0, t: 1, type: "handoff", status: "ok" },
      { s: 1, t: 2, type: "llm_call", status: "ok" },
      { s: 1, t: 3, type: "tool_call", status: "ok" },
      { s: 3, t: 1, type: "error", status: "error" },
    ],
  }

  it("types the lanes of a run feed shape like the full event list", () => {
    expect(shapeParticipants(shape).map((p) => [p.name, p.kind])).toEqual([
      ["User", "user"],
      ["Orchestrator", "orchestrator"],
      ["zai.glm-5", "llm"],
      ["iam_resolve_user_scope", "tool"],
    ])
  })

  it("an error's source in a shape is a tool", () => {
    const s: RunShape = { participants: ["Orchestrator", "crm_user_sync"], events: [{ s: 1, t: 0, type: "error", status: "error" }] }
    expect(shapeParticipants(s)[1].kind).toBe("tool")
  })

  it("ignores events pointing past the lanes; a lane with no event is typed by name", () => {
    const s: RunShape = {
      participants: ["Orchestrator", "zai.glm-5", "user_db"],
      events: [
        { s: 0, t: 1, type: "llm_call", status: "ok" },
        { s: 0, t: 7, type: "tool_call", status: "ok" },
      ],
    }
    expect(shapeParticipants(s).map((p) => p.kind)).toEqual(["orchestrator", "llm", "user"])
  })

  it("an empty shape has no participants", () => {
    expect(shapeParticipants({ participants: [], events: [] })).toEqual([])
  })
})

describe("kindLookup", () => {
  it("reads a kind from the participant list, falling back to the name", () => {
    const kindOf = kindLookup(extractParticipants([ev("Orchestrator", "iam_resolve_user_scope", "tool_call")]))
    expect(kindOf("iam_resolve_user_scope")).toBe("tool")
    expect(kindOf("gpt-4o")).toBe("llm")
  })
})
