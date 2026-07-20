"use client"

import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api, formatRelative } from "@/lib/api"
import { useNav } from "@/lib/store"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { toast } from "sonner"
import {
  KeyRound,
  Trash2,
  Copy,
  Check,
  RefreshCw,
  Cable,
  Terminal,
} from "lucide-react"

interface KeyRow {
  id: string
  prefix: string
  label: string | null
  createdAt: string
  lastUsedAt: string | null
}
interface Project {
  id: string
  name: string
  description: string | null
  createdAt: string
  _count: { runs: number }
  runs: any[]
}

export function IntegrationView() {
  const { projectId, go } = useNav()
  const qc = useQueryClient()
  const [selectedProject, setSelectedProject] = useState<string | null>(projectId)
  const [revealedKey, setRevealedKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const { data: projectsData } = useQuery<{ projects: Project[] }>({
    queryKey: ["projects"],
    queryFn: () => api("/api/projects"),
  })

  const projects = projectsData?.projects || []
  // derive the effective project: explicit selection, or the first available
  const effectiveProject = selectedProject || projects[0]?.id || null

  const { data: keysData, isLoading: keysLoading } = useQuery<{ keys: KeyRow[] }>({
    queryKey: ["keys", effectiveProject],
    queryFn: () => api(`/api/keys?projectId=${effectiveProject}`),
    enabled: !!effectiveProject,
  })

  const createKeyMut = useMutation({
    mutationFn: () =>
      api<{ key: KeyRow; rawKey: string }>(`/api/keys`, {
        method: "POST",
        json: { projectId: effectiveProject, label: "Default key" },
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["keys", effectiveProject] })
      setRevealedKey(data.rawKey)
      toast.success("Key regenerated")
    },
    onError: (e) => toast.error("Failed: " + (e as Error).message),
  })

  const deleteKeyMut = useMutation({
    mutationFn: (id: string) =>
      api(`/api/keys/${id}?projectId=${effectiveProject}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["keys", effectiveProject] })
      toast.success("Key revoked")
    },
  })

  const keys = keysData?.keys || []
  const currentProject = projects.find((p) => p.id === effectiveProject)

  const copy = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {"// wire your agents in"}
        </p>
        <h1 className="text-2xl font-semibold mt-0.5">Integration</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Stream events from your agent with a single HTTP endpoint. Use an API key to
          authenticate — it's scoped per project, not per user session.
        </p>
      </div>

      {projects.length === 0 ? (
        <Card className="p-10 text-center">
          <Cable className="h-8 w-8 text-muted-foreground mx-auto" />
          <p className="mt-3 text-sm text-muted-foreground">
            Create a project first to get an API key and integration snippets.
          </p>
          <Button className="mt-4" onClick={() => go("projects")}>
            Go to projects
          </Button>
        </Card>
      ) : (
        <>
          {/* project selector */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Project
              </label>
              <Select value={effectiveProject || undefined} onValueChange={setSelectedProject}>
                <SelectTrigger className="w-64">
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => createKeyMut.mutate()} disabled={createKeyMut.isPending} className="gap-1.5">
              <RefreshCw className={`h-4 w-4 ${createKeyMut.isPending ? "animate-spin" : ""}`} />
              Regenerate key
            </Button>
          </div>

          {/* revealed key */}
          {revealedKey && (
            <Card className="p-4 border-amber-500/40 bg-amber-500/5">
              <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-amber-400" />
                <p className="text-sm font-medium">New API key — copy it now</p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-7 gap-1.5 text-xs"
                  onClick={() => copy(revealedKey)}
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setRevealedKey(null)}>
                  Dismiss
                </Button>
              </div>
              <code className="mt-2 block rounded-md bg-background/60 border border-border px-3 py-2 font-mono text-xs break-all">
                {revealedKey}
              </code>
              <p className="mt-2 text-[11px] text-amber-400/80">
                We only show the full key once. Store it somewhere safe.
              </p>
            </Card>
          )}

          {/* keys list */}
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
              API keys
            </p>
            {keysLoading ? (
              <Skeleton className="h-16" />
            ) : keys.length === 0 ? (
              <Card className="p-6 text-center text-sm text-muted-foreground">
                No keys yet. Generate one above.
              </Card>
            ) : (
              <div className="space-y-1.5">
                {keys.map((k) => (
                  <Card key={k.id} className="px-4 py-3 flex items-center gap-3">
                    <KeyRound className="h-4 w-4 text-muted-foreground shrink-0" />
                    <code className="font-mono text-sm">{k.prefix}…</code>
                    <span className="text-xs text-muted-foreground hidden sm:inline">
                      {k.label || "Default key"}
                    </span>
                    <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                      used {formatRelative(k.lastUsedAt)}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-red-400"
                      onClick={() => deleteKeyMut.mutate(k.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </Card>
                ))}
              </div>
            )}
          </div>

          {/* snippets */}
          <SnippetBlock
            projectId={effectiveProject || ""}
            projectName={currentProject?.name || "your-project"}
            apiKey={revealedKey || `atr_YOUR_API_KEY`}
          />

          {/* endpoint reference */}
          <Card className="p-4">
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-3">
              endpoint reference
            </p>
            <div className="space-y-2 font-mono text-xs">
              <RefRow method="POST" path="/api/events" desc="Ingest an event (or create a run with runId: null)" />
              <RefRow method="GET" path="/api/runs/:id" desc="Fetch a run with all its events" />
              <RefRow method="PATCH" path="/api/runs/:id" desc="Update run status (completed / failed)" />
            </div>
            <div className="mt-4 rounded-md border border-border bg-background/60 p-3 font-mono text-[11px] text-muted-foreground">
              <p className="text-foreground/80">Event body:</p>
              <pre className="mt-1.5 whitespace-pre-wrap">{`{
  "runId": "run_abc123",       // omit/null to create a new run
  "source": "Orchestrator",
  "target": "web_search",
  "type": "tool_call",          // llm_call | tool_call | tool_result | handoff | error | final_answer
  "label": "web_search(query)",
  "payload": { "args": { "query": "..." } },
  "durationMs": 720,
  "status": "ok",               // ok | error | pending
  "endRun": "completed"         // optional: "completed" | "failed" to close the run
}`}</pre>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}

function RefRow({ method, path, desc }: { method: string; path: string; desc: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="rounded bg-primary/15 text-primary px-1.5 py-0.5 text-[10px] font-bold w-12 text-center">
        {method}
      </span>
      <code className="text-primary/90">{path}</code>
      <span className="text-muted-foreground hidden sm:inline">— {desc}</span>
    </div>
  )
}

function SnippetBlock({
  projectId,
  projectName,
  apiKey,
}: {
  projectId: string
  projectName: string
  apiKey: string
}) {
  const [lang, setLang] = useState<"python" | "typescript" | "deepagents" | "projection" | "easy">("easy")
  const [copied, setCopied] = useState(false)

  const snippet =
    lang === "python"
      ? pythonSnippet(projectName, apiKey)
      : lang === "typescript"
      ? tsSnippet(projectName, apiKey)
      : lang === "deepagents"
      ? deepagentsSnippet(projectName, apiKey)
      : lang === "projection"
      ? projectionSnippet(projectName, apiKey)
      : easySnippet(projectName, apiKey)

  const copy = () => {
    navigator.clipboard.writeText(snippet)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-card/60">
        <Terminal className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">Instrument your agent</span>
        <span className="font-mono text-[10px] text-muted-foreground hidden sm:inline">
          · {projectName}
        </span>
        <Tabs value={lang} onValueChange={(v) => setLang(v as any)} className="ml-auto">
          <TabsList className="h-7">
            <TabsTrigger value="python" className="text-xs px-2.5 py-0.5">Python</TabsTrigger>
            <TabsTrigger value="typescript" className="text-xs px-2.5 py-0.5">TypeScript</TabsTrigger>
            <TabsTrigger value="deepagents" className="text-xs px-2.5 py-0.5">DeepAgents</TabsTrigger>
            <TabsTrigger value="projection" className="text-xs px-2.5 py-0.5">Projection</TabsTrigger>
            <TabsTrigger value="easy" className="text-xs px-2.5 py-0.5 bg-primary/10 text-primary">✦ Easy</TabsTrigger>
          </TabsList>
        </Tabs>
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={copy}>
          {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      {lang === "deepagents" && (
        <div className="px-4 py-2 border-b border-border bg-primary/5 text-[11px] text-muted-foreground">
          Drop-in <code className="font-mono text-primary/80">BaseCallbackHandler</code> for{" "}
          <code className="font-mono">langchain-deepagents</code> — tracks the orchestrator,
          LLM calls, every tool call/result, sub-agent handoffs, and the final answer as a live
          AgentTrace sequence diagram.
        </div>
      )}
      {lang === "projection" && (
        <div className="px-4 py-2 border-b border-border bg-primary/5 text-[11px] text-muted-foreground">
          For production runtimes that already have a <strong>stream projection</strong> (FastAPI SSE,
          LangGraph stream, custom event bus). Map your projected events to AgentTrace arrows —
          no LangChain callbacks, non-blocking queue, fail-safe. Best when your projection already
          carries main/sub-agent attribution and ordering.
        </div>
      )}
      {lang === "easy" && (
        <div className="px-4 py-2 border-b border-border bg-primary/10 text-[11px] text-muted-foreground">
          <strong className="text-primary">Minimal setup.</strong> Drop <code className="font-mono text-primary/80">agenttrace.py</code> in your
          project once, then use a context manager <code className="font-mono">with trace(…) as run:</code> or a
          <code className="font-mono">@traced</code> decorator. Auto start/end/error, optional LangChain
          auto-attach via <code className="font-mono">callbacks=run.callbacks</code>.
        </div>
      )}
      <div className="relative">
        <pre className="at-graticule p-4 overflow-x-auto at-scroll text-[12px] leading-relaxed font-mono text-foreground/90 max-h-[520px]">
          <code>{snippet}</code>
        </pre>
      </div>
    </Card>
  )
}

function pythonSnippet(project: string, apiKey: string) {
  return `import requests, time, uuid

# AgentTrace ingestion — ${project}
AGENTTRACE_URL = "http://localhost:3000/api/events"  # use your deployment URL
API_KEY = "${apiKey}"                                   # project-scoped key

headers = {"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}

def emit(event: dict) -> dict:
    r = requests.post(AGENTTRACE_URL, json=event, headers=headers)
    r.raise_for_status()
    return r.json()

# 1. Start a run (runId=None → server creates one and returns it)
run = emit({"runId": None, "name": "demo refund flow"})
run_id = run["runId"]
print("run started:", run_id)

# 2. User message arrives → orchestrator
emit({"runId": run_id, "source": "User", "target": "Orchestrator",
      "type": "handoff", "label": "incoming message",
      "payload": {"message": "please refund order #4821"}, "durationMs": 90})

# 3. Orchestrator → LLM (classify intent)
emit({"runId": run_id, "source": "Orchestrator", "target": "LLM",
      "type": "llm_call", "label": "classify intent",
      "payload": {"prompt": "...", "result": "refund_request", "tokens": 184},
      "durationMs": 480})

# 4. Orchestrator → tool call (lookup_order)
emit({"runId": run_id, "source": "Orchestrator", "target": "lookup_order",
      "type": "tool_call", "label": "lookup_order(#4821)",
      "payload": {"args": {"orderId": "4821"}}, "durationMs": 310})

# 5. tool result back to orchestrator
emit({"runId": run_id, "source": "lookup_order", "target": "Orchestrator",
      "type": "tool_result", "label": "order found",
      "payload": {"orderId": "4821", "total": 89.99, "status": "shipped"},
      "durationMs": 5})

# 6. Final answer to the user
emit({"runId": run_id, "source": "Orchestrator", "target": "User",
      "type": "final_answer", "label": "refund issued",
      "payload": {"answer": "A refund of $89.99 has been processed."},
      "durationMs": 80})

# 7. Close the run
emit({"runId": run_id, "endRun": "completed"})
print("run completed — open the live trace view to watch it replay")`
}

function tsSnippet(project: string, apiKey: string) {
  return `// AgentTrace ingestion — ${project}
const AGENTTRACE_URL = "http://localhost:3000/api/events"; // your deployment URL
const API_KEY = "${apiKey}";                                // project-scoped key

async function emit(event: Record<string, unknown>) {
  const res = await fetch(AGENTTRACE_URL, {
    method: "POST",
    headers: {
      Authorization: \`Bearer \${API_KEY}\`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(event),
  });
  if (!res.ok) throw new Error(\`ingest failed: \${res.status}\`);
  return res.json();
}

async function main() {
  // 1. Start a run (runId omitted → server creates one)
  const run = await emit({ runId: null, name: "demo refund flow" });
  const runId = run.runId;
  console.log("run started:", runId);

  // 2. User message → orchestrator
  await emit({
    runId, source: "User", target: "Orchestrator",
    type: "handoff", label: "incoming message",
    payload: { message: "please refund order #4821" }, durationMs: 90,
  });

  // 3. Orchestrator → LLM (classify intent)
  await emit({
    runId, source: "Orchestrator", target: "LLM",
    type: "llm_call", label: "classify intent",
    payload: { prompt: "...", result: "refund_request", tokens: 184 },
    durationMs: 480,
  });

  // 4. Orchestrator → tool call
  await emit({
    runId, source: "Orchestrator", target: "lookup_order",
    type: "tool_call", label: "lookup_order(#4821)",
    payload: { args: { orderId: "4821" } }, durationMs: 310,
  });

  // 5. tool result back
  await emit({
    runId, source: "lookup_order", target: "Orchestrator",
    type: "tool_result", label: "order found",
    payload: { orderId: "4821", total: 89.99, status: "shipped" },
    durationMs: 5,
  });

  // 6. Final answer
  await emit({
    runId, source: "Orchestrator", target: "User",
    type: "final_answer", label: "refund issued",
    payload: { answer: "A refund of $89.99 has been processed." },
    durationMs: 80,
  });

  // 7. Close the run
  await emit({ runId, endRun: "completed" });
  console.log("run completed — open the live trace view to watch it replay");
}

main().catch(console.error);`
}

function deepagentsSnippet(project: string, apiKey: string) {
  return `# AgentTrace × LangChain DeepAgents — ${project}
#
# pip install langchain langchain-openai langchain-deepagents requests
#
# This file defines:
#   1. AgentTraceCallback  — a LangChain BaseCallbackHandler that streams
#      orchestrator ↔ LLM, tool_call/tool_result, handoffs and the final
#      answer to AgentTrace as a live sequence diagram.
#   2. A small DeepAgents example (planner + tools + sub-agent) wired up
#      with the callback so you can see the diagram populate in real time.
#
# DeepAgents emits the standard LangChain callback events
# (on_llm_start/end, on_tool_start/end, on_agent_action/finish, and the
# 'handoff' tags when delegating to a sub-agent), so this handler works
# for create_deep_agent / create_react_agent / any Runnable that supports
# callbacks.

import time, uuid, requests, json, os
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union
from uuid import UUID

from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.agents import AgentAction, AgentFinish
from langchain_core.outputs import LLMResult
from langchain_core.messages import BaseMessage

# ──────────────────────────────────────────────────────────────────────
# 1. AgentTrace ingestion client + LangChain callback handler
# ──────────────────────────────────────────────────────────────────────

AGENTTRACE_URL = os.getenv("AGENTTRACE_URL", "http://localhost:3000/api/events")
AGENTTRACE_KEY = os.getenv("AGENTTRACE_KEY", "${apiKey}")   # project-scoped key


def emit(event: dict) -> dict:
    """POST a single event to AgentTrace. Returns the server response."""
    r = requests.post(
        AGENTTRACE_URL,
        json=event,
        headers={"Authorization": f"Bearer {AGENTTRACE_KEY}",
                 "Content-Type": "application/json"},
        timeout=10,
    )
    r.raise_for_status()
    return r.json()


class AgentTraceCallback(BaseCallbackHandler):
    """Streams a DeepAgents run to AgentTrace as a live sequence diagram.

    One instance = one run. Attach it to any agent invocation:

        agent.invoke({"messages": [...]}, config={"callbacks": [AgentTraceCallback("research run")]})
    """

    def __init__(self, run_name: str = "deepagents run", orchestrator: str = "Orchestrator"):
        self.run_name = run_name
        self.orchestrator = orchestrator
        self.run_id: Optional[str] = None
        # stack of (tool/sub-agent name, start_ts) for nesting + latency
        self._stack: List[Tuple[str, float]] = []
        # the tool or sub-agent the orchestrator currently handed off to
        self._current_target: Optional[str] = None

    # ----- run lifecycle -----
    def _ensure_run(self):
        if self.run_id is None:
            res = emit({"runId": None, "name": self.run_name})
            self.run_id = res["runId"]

    # ----- LLM calls -----
    def on_llm_start(self, serialized, prompts, **kwargs):
        self._ensure_run()
        # DeepAgents wraps the model; we treat every LLM step as orchestrator → LLM
        model = _model_name(serialized) or "LLM"
        self._llm_start = time.time()
        self._llm_model = model

    def on_chat_model_start(self, serialized, messages, **kwargs):
        # chat models fire on_chat_model_start instead of on_llm_start
        self.on_llm_start(serialized, messages, **kwargs)

    def on_llm_end(self, response: LLMResult, **kwargs):
        dur = int((time.time() - getattr(self, "_llm_start", time.time())) * 1000)
        # pull a short preview of the generation
        text = ""
        try:
            text = response.generations[0][0].text or ""
        except Exception:
            pass
        emit({
            "runId": self.run_id,
            "source": self.orchestrator,
            "target": getattr(self, "_llm_model", "LLM"),
            "type": "llm_call",
            "label": "llm step",
            "payload": {"output_preview": text[:240], **_flat_tokens(response)},
            "durationMs": dur,
        })

    # ----- tool calls (DeepAgents tools + sub-agent handoffs) -----
    def on_tool_start(self, serialized, input_str, **kwargs):
        tool = serialized.get("name", "tool")
        self._current_target = tool
        self._stack.append((tool, time.time()))
        emit({
            "runId": self.run_id,
            "source": self.orchestrator,
            "target": tool,
            "type": "tool_call",
            "label": f"{tool}({input_str[:60]})",
            "payload": {"args": input_str},
            "durationMs": None,
        })

    def on_tool_end(self, output: str, **kwargs):
        tool, start = (self._stack.pop() if self._stack else ("tool", time.time()))
        dur = int((time.time() - start) * 1000)
        emit({
            "runId": self.run_id,
            "source": tool,
            "target": self.orchestrator,
            "type": "tool_result",
            "label": f"{tool} → result",
            "payload": {"result": output[:500]},
            "durationMs": dur,
        })
        self._current_target = None

    def on_tool_error(self, error, **kwargs):
        tool, start = (self._stack.pop() if self._stack else ("tool", time.time()))
        emit({
            "runId": self.run_id,
            "source": tool,
            "target": self.orchestrator,
            "type": "error",
            "label": f"{tool} failed",
            "payload": {"error": type(error).__name__, "message": str(error)},
            "status": "error",
        })

    # ----- agent action / finish (covers the ReAct + DeepAgents loop) -----
    def on_agent_action(self, action: AgentAction, **kwargs):
        # DeepAgents tags a handoff to a sub-agent as a tool call whose name
        # contains 'handoff' or matches a sub-agent name. Detect it and emit
        # a handoff event so the diagram shows the sub-agent lifeline.
        tool = getattr(action, "tool", "")
        if "handoff" in tool.lower() or "delegate" in tool.lower():
            sub = _extract_handoff_target(tool, action.tool_input)
            emit({
                "runId": self.run_id,
                "source": self.orchestrator,
                "target": sub or "Sub-agent",
                "type": "handoff",
                "label": f"delegate → {sub or 'sub-agent'}",
                "payload": {"task": str(action.tool_input)[:200]},
                "durationMs": None,
            })
            self._current_target = sub or "Sub-agent"

    def on_agent_finish(self, finish: AgentFinish, **kwargs):
        # the orchestrator's final answer back to the user
        answer = finish.return_values.get("output") if hasattr(finish, "return_values") else ""
        emit({
            "runId": self.run_id,
            "source": self.orchestrator,
            "target": "User",
            "type": "final_answer",
            "label": "final answer",
            "payload": {"answer": str(answer)[:500]},
        })
        # close the run
        emit({"runId": self.run_id, "endRun": "completed"})


def _model_name(serialized) -> str:
    try:
        return serialized.get("id", [None])[-1] or serialized.get("name") or "LLM"
    except Exception:
        return "LLM"


def _token_usage(response: LLMResult) -> Optional[dict]:
    try:
        u = response.llm_output or {}
        return u.get("token_usage") or u
    except Exception:
        return None


def _flat_tokens(response: LLMResult) -> dict:
    """Flatten token usage to the standard {prompt_tokens, completion_tokens, total_tokens}."""
    u = _token_usage(response) or {}
    pt = u.get("prompt_tokens", u.get("input_tokens", 0))
    ct = u.get("completion_tokens", u.get("output_tokens", 0))
    tt = u.get("total_tokens", u.get("total", (pt or 0) + (ct or 0)))
    if not (pt or ct or tt):
        return {}
    return {"prompt_tokens": pt or 0, "completion_tokens": ct or 0, "total_tokens": tt}


def _extract_handoff_target(tool_name: str, tool_input) -> Optional[str]:
    """Best-effort: pull the sub-agent name out of a handoff tool call."""
    try:
        if isinstance(tool_input, dict):
            return tool_input.get("to") or tool_input.get("name") or tool_input.get("agent")
    except Exception:
        pass
    return None


# ──────────────────────────────────────────────────────────────────────
# 2. Example: a DeepAgents run instrumented with AgentTrace
# ──────────────────────────────────────────────────────────────────────

def main():
    from langchain_openai import ChatOpenAI
    from langchain_core.tools import tool
    # deepagents provides create_deep_agent (planner + executor + sub-agents)
    try:
        from deepagents import create_deep_agent
    except ImportError:
        print("pip install langchain-deepagents  (or your internal deepagents package)")
        return

    @tool
    def web_search(query: str) -> str:
        """Search the web and return the top results as text."""
        return f"[stub] top results for: {query}"

    @tool
    def fetch_page(url: str) -> str:
        """Fetch and return the text content of a web page."""
        return f"[stub] content of {url}"

    model = ChatOpenAI(model="gpt-4o-mini", temperature=0)

    # create_deep_agent wires up a planner, an executor with tools, and
    # optional sub-agents. Attach our callback to stream every step.
    agent = create_deep_agent(
        model=model,
        tools=[web_search, fetch_page],
        system_prompt=(
            "You are a research assistant. Use web_search + fetch_page to "
            "answer the user's question, then synthesize a cited summary."
        ),
    )

    # 👇 one callback instance = one AgentTrace run
    trace = AgentTraceCallback(run_name="research — state of Rust web frameworks")

    result = agent.invoke(
        {"messages": [{"role": "user", "content": "What's the state of Rust web frameworks in 2025?"}]},
        config={"callbacks": [trace]},
    )

    print("answer:", result["messages"][-1].content)
    print("trace:  open the run in AgentTrace to replay it frame by frame")


if __name__ == "__main__":
    main()`
}

function projectionSnippet(project: string, apiKey: string) {
  return `# AgentTrace × Stream Projection — ${project}
#
# For production runtimes that ALREADY have a stream projection (FastAPI SSE,
# LangGraph stream, custom event bus). Instead of LangChain callbacks, map your
# projected StreamEvent kinds → AgentTrace arrows.
#
# Guarantees (same as a production integration):
# - **non-blocking**: emit() pushes to an asyncio.Queue, drained by a single
#   worker per run (order preserved, AgentTrace seq follows arrival order)
# - **never fatal**: the first network error disables tracing for the run
#   (one warning), the chat/run continues unaffected
# - **bounded payloads**: args/results/answers truncated before sending
#
# Drop this file in your codebase (e.g. app/core/agenttrace.py) and wire 3
# calls into your existing stream consumer (see bottom).

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any

import httpx

logger = logging.getLogger(__name__)

# Preview limits (full detail stays in your audit backend; AgentTrace is a
# visualization tool, not an archive).
_LABEL_LIMIT = 80
_PAYLOAD_LIMIT = 2000
_RESULT_LIMIT = 500
_ANSWER_LIMIT = 500

ORCHESTRATOR = "Orchestrator"  # AgentTrace recognizes "orchestrator" as the lead kind

_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=10.0)
    return _client


def _truncate(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[:limit] + "…"


def _compact(value: Any, limit: int = _PAYLOAD_LIMIT) -> Any:
    try:
        text = json.dumps(value, ensure_ascii=False, default=str)
    except (TypeError, ValueError):
        return _truncate(repr(value), limit)
    return value if len(text) <= limit else _truncate(text, limit)


class AgentTraceRun:
    """One AgentTrace run = one chat/agent run. All methods are non-blocking.

    The remote run is created lazily (first event) by the worker.
    aclose() waits for the queue to drain (bounded) after your terminal event.
    """

    def __init__(self, name: str, *, url: str, api_key: str, client: httpx.AsyncClient):
        self._name = _truncate(name, 120)
        self._url = url
        self._headers = {"Authorization": f"Bearer {api_key}"}
        self._client = client
        self._queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()
        self._run_id: str | None = None
        self._failed = False
        # latency tracking: tool_call id / subagent source → start time
        self._tool_started: dict[str, float] = {}
        self._subagent_started: dict[str, float] = {}
        self._worker = asyncio.create_task(self._drain())

    # ── High-level API called by your stream consumer ────────────────

    def on_user_message(self, message: str) -> None:
        self._emit(
            source="User", target=ORCHESTRATOR, event_type="handoff",
            label=_truncate(message, _LABEL_LIMIT) or "user message",
            payload={"message": _truncate(message, _PAYLOAD_LIMIT)},
        )

    def on_stream_event(self, kind: str, source: str, data: dict[str, Any]) -> None:
        """Map YOUR projected StreamEvent → AgentTrace arrow.

        Adapt the 'kind' values to match your projection. The mapping below
        assumes a v3-style projection with: tool_call, tool_result,
        agent_start (subagent), agent_end (subagent), approval_required, final.
        """
        actor = ORCHESTRATOR if source == "main" else source

        if kind == "tool_call":
            name = str(data.get("name", "tool"))
            tool_id = str(data.get("id", ""))
            self._tool_started[tool_id] = time.monotonic()
            args_preview = _truncate(
                json.dumps(data.get("args", {}), ensure_ascii=False, default=str), 60
            )
            self._emit(
                source=actor, target=name, event_type="tool_call",
                label=f"{name}({args_preview})",
                payload={"args": _compact(data.get("args", {}))},
            )

        elif kind == "tool_result":
            name = str(data.get("name", "tool"))
            started = self._tool_started.pop(str(data.get("id", "")), None)
            self._emit(
                source=name, target=actor, event_type="tool_result",
                label=f"{name} → result",
                payload={"result": _truncate(str(data.get("result", "")), _RESULT_LIMIT)},
                duration_ms=_elapsed_ms(started),
            )

        elif kind == "agent_start" and data.get("scope") == "subagent":
            self._subagent_started[source] = time.monotonic()
            self._emit(
                source=ORCHESTRATOR, target=source, event_type="handoff",
                label=f"delegate → {source}",
                payload={"task": _truncate(str(data.get("label", "")), _PAYLOAD_LIMIT)},
            )

        elif kind == "agent_end" and data.get("scope") == "subagent":
            started = self._subagent_started.pop(source, None)
            failed = data.get("status") == "failed"
            self._emit(
                source=source, target=ORCHESTRATOR,
                event_type="error" if failed else "tool_result",
                label=f"{source} → {'failed' if failed else 'return'}",
                payload={"status": data.get("status"), "error": data.get("error")},
                duration_ms=_elapsed_ms(started),
                status="error" if failed else "ok",
            )

        elif kind == "approval_required":
            self._emit(
                source=ORCHESTRATOR, target="User", event_type="handoff",
                label="HITL: approval required",
                payload={"action_requests": _compact(data.get("action_requests", []))},
                status="pending",
            )

        elif kind == "final":
            self._emit(
                source=ORCHESTRATOR, target="User", event_type="final_answer",
                label="final answer",
                payload={"answer": _truncate(str(data.get("message", "")), _ANSWER_LIMIT)},
            )
        # token / todo / chart: noise for a sequence diagram — ignored.

    def on_error(self, message: str) -> None:
        self._emit(
            source=ORCHESTRATOR, target="User", event_type="error",
            label="run failed",
            payload={"error": _truncate(message, _PAYLOAD_LIMIT)},
            status="error",
        )

    def end(self, status: str = "completed") -> None:
        """Close the AgentTrace run ('completed' or 'failed')."""
        if self._failed:
            return
        self._queue.put_nowait(
            {"endRun": "failed" if status == "failed" else "completed"}
        )

    async def aclose(self) -> None:
        """Wait (bounded) for the queue to drain, then stop the worker."""
        self._queue.put_nowait(None)
        try:
            await asyncio.wait_for(self._worker, timeout=10.0)
        except Exception:  # tracing must never break a run
            self._worker.cancel()

    # ── Internals ────────────────────────────────────────────────────

    def _emit(self, *, source, target, event_type, label=None, payload=None,
              duration_ms=None, status=None) -> None:
        if self._failed:
            return
        event: dict[str, Any] = {
            "source": source, "target": target, "type": event_type,
            "label": label, "payload": payload or {},
        }
        if duration_ms is not None:
            event["durationMs"] = duration_ms
        if status is not None:
            event["status"] = status
        self._queue.put_nowait(event)

    async def _drain(self) -> None:
        while True:
            item = await self._queue.get()
            if item is None:
                return
            if self._failed:
                continue
            try:
                if self._run_id is None:
                    created = await self._post({"runId": None, "name": self._name})
                    self._run_id = created["runId"]
                await self._post({"runId": self._run_id, **item})
            except Exception as exc:  # never fatal for the chat
                self._failed = True
                logger.warning(
                    "AgentTrace disabled for this run (cannot reach %s): %s",
                    self._url, exc,
                )

    async def _post(self, body: dict[str, Any]) -> dict[str, Any]:
        r = await self._client.post(self._url, json=body, headers=self._headers)
        r.raise_for_status()
        return r.json()


def _elapsed_ms(started: float | None) -> int | None:
    return int((time.monotonic() - started) * 1000) if started is not None else None


def maybe_trace_run(name: str) -> "AgentTraceRun | None":
    """Create an AgentTrace run if configured, else None. Never raises."""
    import os
    url = os.getenv("AGENTTRACE_URL", "http://localhost:3000/api/events")
    key = os.getenv("AGENTTRACE_KEY", "${apiKey}")
    if not key or key == "atr_YOUR_API_KEY":
        return None
    try:
        return AgentTraceRun(name, url=url, api_key=key, client=_get_client())
    except RuntimeError:
        return None  # no asyncio loop (sync script / tests)


# ── Wiring into your existing stream consumer (3 touch points) ──────
#
# # 1. At run start:
# tracer = maybe_trace_run(user_message)
# if tracer:
#     tracer.on_user_message(user_message)
#
# # 2. In your stream loop (alongside your existing SSE _put):
# async for ev in your_projection(agent, payload, ...):
#     if tracer:
#         tracer.on_stream_event(ev.kind, ev.source, ev.data)
#     # ... your existing SSE emit, audit, etc.
#
# # 3. At run end / error (after your terminal 'done' SSE, so it doesn't
# #    delay the client):
# if tracer:
#     if error:
#         tracer.on_error(str(error))
#         tracer.end("failed")
#     else:
#         tracer.end("completed")
#     await tracer.aclose()`
}

function easySnippet(project: string, apiKey: string) {
  return `# ──────────────────────────────────────────────────────────────────
# agenttrace.py  —  ergonomic AgentTrace wrapper (${project})
# ──────────────────────────────────────────────────────────────────
# Drop this file in your project ONCE. Then:
#
#   # 1. Context manager (auto start / end / error):
#   from agenttrace import trace
#   with trace("research — Rust frameworks") as run:
#       result = my_agent.invoke(...)
#
#   # 2. Decorator (every call = a traced run):
#   from agenttrace import traced
#   @traced
#   def run_agent(query: str):
#       return my_agent.invoke({"messages": [{"role": "user", "content": query}]})
#
#   # 3. LangChain / DeepAgents auto-attach (zero manual callbacks):
#   with trace("my run") as run:
#       agent.invoke(input, config={"callbacks": run.callbacks})
#
# pip install httpx  (and langchain-core if you use auto-attach)
# env: AGENTTRACE_URL, AGENTTRACE_KEY

from __future__ import annotations
import os, time, json, threading, queue, functools
from typing import Any

import httpx

_URL  = os.getenv("AGENTTRACE_URL", "http://localhost:3000/api/events")
_KEY  = os.getenv("AGENTTRACE_KEY", "${apiKey}")
_MAX  = 2000  # payload preview limit

_queue: queue.Queue[dict | None] = queue.Queue()
_started = False

def _worker() -> None:
    """Background sender — non-blocking, fail-safe (errors are swallowed)."""
    while True:
        item = _queue.get()
        if item is None:
            return
        try:
            httpx.post(_URL, json=item,
                       headers={"Authorization": f"Bearer {_KEY}"}, timeout=5)
        except Exception:
            pass  # tracing must never break the agent

def _ensure_worker() -> None:
    global _started
    if not _started:
        threading.Thread(target=_worker, daemon=True).start()
        _started = True

def _send(event: dict) -> None:
    _queue.put(event)

def _trunc(v: Any, n: int = _MAX) -> Any:
    try:
        s = json.dumps(v, ensure_ascii=False, default=str)
    except Exception:
        return str(v)[:n]
    return v if len(s) <= n else s[:n] + "…"


class Run:
    """A traced run. Created by trace() / traced — don't instantiate directly."""

    def __init__(self, name: str):
        self.name = name[:120]
        self._id: str | None = None
        self._t0: dict[str, float] = {}     # tool/llm name → start monotonic
        self._callbacks: list | None = None

    def _create(self) -> None:
        try:
            r = httpx.post(_URL, json={"runId": None, "name": self.name},
                           headers={"Authorization": f"Bearer {_KEY}"}, timeout=5)
            self._id = r.json()["runId"]
        except Exception:
            self._id = None  # run will be a no-op if creation failed

    def emit(self, source: str, target: str, type: str, *,
             label: str | None = None, payload: Any = None,
             duration_ms: int | None = None, status: str | None = None) -> None:
        """Emit a manual event (arrow) in the sequence diagram."""
        if not self._id:
            return
        ev: dict[str, Any] = {"runId": self._id, "source": source,
                              "target": target, "type": type}
        if label:        ev["label"] = label
        if payload:      ev["payload"] = _trunc(payload)
        if duration_ms:  ev["durationMs"] = duration_ms
        if status:       ev["status"] = status
        _send(ev)

    def close(self, status: str = "completed") -> None:
        if self._id:
            _send({"runId": self._id, "endRun": status})

    @property
    def callbacks(self) -> list:
        """LangChain BaseCallbackHandler list — pass to config={"callbacks": ...}."""
        if self._callbacks is None:
            self._callbacks = [_LangChainCallbacks(self)]
        return self._callbacks


# ── context manager ───────────────────────────────────────────────

class _TraceCtx:
    """Returned by trace() — usable as 'with trace(...) as run:'."""
    def __init__(self, run: Run):
        self.run = run
    def __enter__(self) -> Run:
        return self.run
    def __exit__(self, exc_type, exc, tb) -> bool:
        if exc:
            self.run.emit("Orchestrator", "User", "error",
                          label="run failed",
                          payload={"error": str(exc)}, status="error")
            self.run.close("failed")
        else:
            self.run.close("completed")
        return False  # don't suppress exceptions


def trace(name: str) -> _TraceCtx:
    """Create a traced run. Usage: 'with trace("name") as run: ...'"""
    _ensure_worker()
    run = Run(name)
    run._create()
    return _TraceCtx(run)


# ── decorator ─────────────────────────────────────────────────────

def traced(fn):
    """Decorator: every call to fn becomes a traced AgentTrace run."""
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        # build a readable run name from function + first arg
        suffix = f" — {str(args[0])[:80]}" if args else ""
        with trace(f"{fn.__name__}{suffix}") as run:
            return fn(*args, **kwargs)
    return wrapper


# ── optional: LangChain auto-attach ───────────────────────────────
# Only imported if you actually use run.callbacks — keeps the dep optional.
try:
    from langchain_core.callbacks import BaseCallbackHandler
    from langchain_core.agents import AgentAction, AgentFinish
    from langchain_core.outputs import LLMResult

    class _LangChainCallbacks(BaseCallbackHandler):
        """Auto-maps LangChain events → AgentTrace arrows."""
        def __init__(self, run: Run):
            self.run = run

        def on_llm_start(self, serialized, prompts, **kw):
            self.run._t0["llm"] = time.monotonic()

        def on_chat_model_start(self, serialized, messages, **kw):
            self.on_llm_start(serialized, messages, **kw)

        def on_llm_end(self, response: LLMResult, **kw):
            dur = int((time.monotonic() - self.run._t0.pop("llm", time.monotonic())) * 1000)
            # extract token usage (OpenAI / Anthropic / LangChain standard)
            payload = {}
            try:
                u = (response.llm_output or {}).get("token_usage") \\
                    or (response.llm_output or {}).get("usage") \\
                    or {}
                if u:
                    payload = {
                        "prompt_tokens": u.get("prompt_tokens", u.get("input_tokens", 0)),
                        "completion_tokens": u.get("completion_tokens", u.get("output_tokens", 0)),
                        "total_tokens": u.get("total_tokens", u.get("total", 0)),
                    }
            except Exception:
                pass
            self.run.emit("Orchestrator", "LLM", "llm_call",
                          label="llm step", payload=payload or None,
                          duration_ms=dur)

        def on_tool_start(self, serialized, input_str, **kw):
            name = serialized.get("name", "tool")
            self.run._t0[name] = time.monotonic()
            self.run.emit("Orchestrator", name, "tool_call",
                          label=f"{name}({input_str[:50]})",
                          payload={"args": input_str[:500]})

        def on_tool_end(self, output, **kw):
            # we don't know the tool name here reliably; use last started
            name = next(reversed(self.run._t0), "tool")
            started = self.run._t0.pop(name, None)
            dur = int((time.monotonic() - started) * 1000) if started else None
            self.run.emit(name, "Orchestrator", "tool_result",
                          label=f"{name} → result",
                          payload={"result": str(output)[:500]}, duration_ms=dur)

        def on_tool_error(self, error, **kw):
            name = next(reversed(self.run._t0), "tool")
            self.run._t0.pop(name, None)
            self.run.emit(name, "Orchestrator", "error",
                          label=f"{name} failed",
                          payload={"error": str(error)}, status="error")

        def on_agent_action(self, action: AgentAction, **kw):
            tool = getattr(action, "tool", "")
            if "handoff" in tool.lower() or "delegate" in tool.lower():
                self.run.emit("Orchestrator", tool, "handoff",
                              label=f"delegate → {tool}")

        def on_agent_finish(self, finish: AgentFinish, **kw):
            ans = ""
            try: ans = finish.return_values.get("output", "")
            except Exception: pass
            self.run.emit("Orchestrator", "User", "final_answer",
                          label="final answer", payload={"answer": str(ans)[:500]})

except ImportError:
    # langchain not installed — run.callbacks will raise a clear error if used
    class _LangChainCallbacks:  # type: ignore
        def __init__(self, *_):
            raise ImportError("pip install langchain-core to use run.callbacks")
`
}


