"use client"

import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api, formatRelative } from "@/lib/api"
import { useSession } from "@/lib/session"
import { cn } from "@/lib/utils"
import { useNav } from "@/lib/store"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
import { LoadError } from "@/components/load-error"
import { highlightLine, type TokenKind } from "@/lib/highlight"
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
  const { authMode } = useSession()
  const local = authMode === "none"
  const qc = useQueryClient()
  const [selectedProject, setSelectedProject] = useState<string | null>(projectId)
  const [revealedKey, setRevealedKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const {
    data: projectsData,
    isError: projectsError,
    refetch: refetchProjects,
  } = useQuery<{ projects: Project[] }>({
    queryKey: ["projects"],
    queryFn: () => api("/api/projects"),
  })

  const projects = projectsData?.projects || []
  // derive the effective project: explicit selection, or the first available
  const effectiveProject = selectedProject || projects[0]?.id || null

  const {
    data: keysData,
    isLoading: keysLoading,
    isError: keysError,
    refetch: refetchKeys,
  } = useQuery<{ keys: KeyRow[] }>({
    queryKey: ["keys", effectiveProject],
    queryFn: () => api(`/api/keys?projectId=${effectiveProject}`),
    enabled: !!effectiveProject && !local,
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
    onError: (e) => toast.error("Couldn't create the key: " + (e as Error).message),
  })

  const deleteKeyMut = useMutation({
    mutationFn: (id: string) =>
      api(`/api/keys/${id}?projectId=${effectiveProject}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["keys", effectiveProject] })
      toast.success("Key revoked")
    },
    onError: (e) => toast.error("Couldn't revoke the key: " + (e as Error).message),
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
        <h1 className="text-2xl font-semibold text-[var(--ink)]">Integration</h1>
        <p className="text-sm text-[var(--ink-2)] mt-1 max-w-2xl">
          {local
            ? "Stream events from your agent to this server. Ingestion needs no key in local mode; runs are grouped by project name."
            : "Stream events from your agent with a single HTTP endpoint. Use an API key to authenticate — it's scoped per project, not per user session."}
        </p>
      </div>

      {projectsError && !projectsData ? (
        <LoadError what="your projects" onRetry={refetchProjects} />
      ) : projects.length === 0 && !local ? (
        <Card className="p-10 text-center">
          <Cable className="h-8 w-8 text-[var(--ink-3)] mx-auto" />
          <p className="mt-3 text-sm text-[var(--ink-2)]">
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
              <label id="integration-project" className="block text-xs font-medium text-[var(--ink-2)]">
                Project
              </label>
              {/* Always controlled: "" (no project yet) shows the placeholder. */}
              <Select value={effectiveProject ?? ""} onValueChange={setSelectedProject}>
                <SelectTrigger className="w-64" aria-labelledby="integration-project">
                  <SelectValue placeholder="Select a project" />
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
            {!local && (
              <Button onClick={() => createKeyMut.mutate()} disabled={createKeyMut.isPending} className="gap-1.5">
                <RefreshCw className={`h-4 w-4 ${createKeyMut.isPending ? "animate-spin motion-reduce:animate-none" : ""}`} />
                Regenerate key
              </Button>
            )}
          </div>

          {/* revealed key */}
          {!local && revealedKey && (
            <Card className="p-4 border-[var(--ev-handoff)] bg-[color-mix(in_oklab,var(--ev-handoff)_6%,var(--surface-1))]">
              <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-[var(--ev-handoff-text)]" />
                <p className="text-sm font-medium">New API key: copy it now</p>
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
              <code className="mt-2 block rounded-[var(--radius-control)] bg-[var(--surface-0)] border border-[var(--line)] px-3 py-2 font-mono text-xs break-all">
                {revealedKey}
              </code>
              <p className="mt-2 text-[11px] text-[var(--ev-handoff-text)]">
                We only show the full key once. Store it somewhere safe.
              </p>
            </Card>
          )}

          {/* keys list */}
          {!local && (
            <div>
              <h2 className="text-sm font-medium text-[var(--ink)] mb-2">API keys</h2>
              {keysError && !keysData ? (
                <LoadError what="the API keys" onRetry={refetchKeys} />
              ) : keysLoading ? (
                <Skeleton className="h-16" />
              ) : keys.length === 0 ? (
                <Card className="p-6 text-center text-sm text-[var(--ink-2)]">
                  No keys yet. Generate one with Regenerate key above.
                </Card>
              ) : (
                <div className="space-y-1.5">
                  {keys.map((k) => (
                    <Card key={k.id} className="px-4 py-3 flex flex-row items-center gap-3">
                      <KeyRound className="h-4 w-4 text-[var(--ink-3)] shrink-0" />
                      <code className="font-mono text-sm">{k.prefix}…</code>
                      <span className="text-xs text-[var(--ink-2)] hidden sm:inline">
                        {k.label || "Default key"}
                      </span>
                      <span className="ml-auto font-mono text-[11px] text-[var(--ink-2)]">
                        used {formatRelative(k.lastUsedAt)}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-[var(--ink-2)] hover:text-[var(--danger)]"
                        aria-label={`Revoke key ${k.prefix}`}
                        onClick={() => deleteKeyMut.mutate(k.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* snippets */}
          <SnippetBlock
            local={local}
            projectName={currentProject?.name || "your-project"}
            apiKey={revealedKey || `atr_YOUR_API_KEY`}
          />

          {/* endpoint reference */}
          <Card className="p-4 gap-0">
            <h2 className="text-sm font-medium text-[var(--ink)] mb-3">Endpoint reference</h2>
            <div className="space-y-2 font-mono text-xs">
              <RefRow method="POST" path="/api/events" desc="Create a run, append an event, or end a run" />
            </div>
            <p className="mt-4 mb-1.5 text-xs text-[var(--ink-2)]">Event body</p>
            <CodeBlock code={EVENT_BODY} className="text-[11px]" />
          </Card>
        </>
      )}
    </div>
  )
}

const EVENT_BODY = `{
  "runId": "run_abc123",       // omit/null to create a new run
  "source": "Orchestrator",
  "target": "web_search",
  "type": "tool_call",          // llm_call | tool_call | tool_result | handoff | error | final_answer
  "label": "web_search(query)",
  "payload": { "args": { "query": "..." } },
  "durationMs": 720,
  "status": "ok",               // ok | error | pending
  "endRun": "completed"         // optional: "completed" | "failed" to close the run
}`

const TOKEN_COLOR: Record<TokenKind, string | undefined> = {
  plain: undefined,
  comment: "text-[var(--ink-3)]",
  string: "text-[var(--ev-result-text)]",
  key: "text-[var(--ev-llm-text)]",
}

/** A code listing in the theme's data font, lightly highlighted. The text is
 * the code exactly (copying a selection gives the original). */
function CodeBlock({ code, className }: { code: string; className?: string }) {
  return (
    <pre
      className={cn(
        "at-scroll overflow-x-auto rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--surface-0)] p-4 font-mono text-[12px] leading-relaxed text-[var(--ink)]",
        className
      )}
    >
      <code>
        {code.split("\n").map((line, i) => (
          <span key={i} className="block min-h-[1lh]">
            {highlightLine(line).map((t, j) =>
              TOKEN_COLOR[t.kind] ? (
                <span key={j} className={TOKEN_COLOR[t.kind]}>
                  {t.text}
                </span>
              ) : (
                t.text
              )
            )}
          </span>
        ))}
      </code>
    </pre>
  )
}

function RefRow({ method, path, desc }: { method: string; path: string; desc: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="rounded-[var(--radius-control)] border border-[var(--action)] text-[var(--action)] px-1.5 py-0.5 text-[10px] font-medium w-12 text-center">
        {method}
      </span>
      <code className="text-[var(--ink)]">{path}</code>
      <span className="font-sans text-[var(--ink-2)] hidden sm:inline">{desc}</span>
    </div>
  )
}

function SnippetBlock({
  local,
  projectName,
  apiKey,
}: {
  local: boolean
  projectName: string
  apiKey: string
}) {
  const [lang, setLang] = useState<"python" | "http" | "deepagents">("python")
  const [copied, setCopied] = useState(false)

  const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000"
  const opts = { origin, projectName, apiKey, local }
  const snippet =
    lang === "python"
      ? pythonSnippet(opts)
      : lang === "http"
      ? httpSnippet(opts)
      : deepagentsSnippet(opts)

  const copy = () => {
    navigator.clipboard.writeText(snippet)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Card className="overflow-hidden gap-0 p-0">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-[var(--line)]">
        <Terminal className="h-4 w-4 text-[var(--ink-2)]" />
        <h2 className="text-sm font-medium">Instrument your agent</h2>
        <span className="font-mono text-[11px] text-[var(--ink-2)] hidden sm:inline">· {projectName}</span>
        <Tabs value={lang} onValueChange={(v) => setLang(v as typeof lang)} className="ml-auto">
          <TabsList className="h-7">
            <TabsTrigger value="python" className="text-xs px-2.5 py-0.5">Python SDK</TabsTrigger>
            <TabsTrigger value="http" className="text-xs px-2.5 py-0.5">HTTP</TabsTrigger>
            <TabsTrigger value="deepagents" className="text-xs px-2.5 py-0.5">DeepAgents</TabsTrigger>
          </TabsList>
        </Tabs>
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={copy}>
          {copied ? <Check className="h-3.5 w-3.5 text-[var(--action)]" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      {lang === "deepagents" && (
        <div className="px-4 py-2 border-b border-[var(--line)] text-[12px] text-[var(--ink-2)]">
          <code className="font-mono text-[var(--ink)]">agenttrace.langchain.autolog()</code> turns
          every <code className="font-mono text-[var(--ink)]">agent.invoke()</code> into a run: LLM calls, tool
          calls and results, handoffs and the final answer, drawn live as a sequence diagram.
        </div>
      )}
      <div className="p-3">
        <CodeBlock code={snippet} className="max-h-[520px]" />
      </div>
    </Card>
  )
}

interface SnippetOpts {
  origin: string
  projectName: string
  apiKey: string
  local: boolean
}

// Values interpolated into generated code become double-quoted string
// literals via JSON.stringify — valid (and safely escaped) in Python and TS.
const q = (value: string) => JSON.stringify(value)
const oneLine = (value: string) => value.replace(/[\r\n\u2028\u2029]+/g, " ")

function pythonSnippet({ origin, projectName, apiKey, local }: SnippetOpts) {
  if (local) {
    return `# pip install deepagents-trace
import agenttrace

agenttrace.set_tracking_uri(${q(origin)})
agenttrace.set_project(${q(projectName)})

with agenttrace.start_run("my run"):
    agenttrace.log_event(source="Orchestrator", target="LLM", type="llm_call", label="classify intent")`
  }
  return `# pip install deepagents-trace
# export AGENTTRACE_TRACKING_URI=${q(origin)}
# export AGENTTRACE_KEY=${q(apiKey)}        # project-scoped key
import os
os.environ.setdefault("AGENTTRACE_TRACKING_URI", ${q(origin)})
os.environ.setdefault("AGENTTRACE_KEY", ${q(apiKey)})

import agenttrace

with agenttrace.start_run("my run"):
    agenttrace.log_event(source="Orchestrator", target="LLM", type="llm_call", label="classify intent")`
}

function httpSnippet({ origin, projectName, apiKey, local }: SnippetOpts) {
  const auth = local
    ? `    headers: { "Content-Type": "application/json" },`
    : `    headers: {
      Authorization: ${q("Bearer " + apiKey)},
      "Content-Type": "application/json",
    },`
  const create = local
    ? `{ runId: null, name: "demo refund flow", project: ${q(projectName)} }`
    : `{ runId: null, name: "demo refund flow" }`
  return `// AgentTrace ingestion — ${oneLine(projectName)}${local ? "" : "\n// Authorization: Bearer " + apiKey}
async function emit(event: Record<string, unknown>) {
  const res = await fetch(${q(origin + "/api/events")}, {
    method: "POST",
${auth}
    body: JSON.stringify(event),
  });
  if (!res.ok) throw new Error(\`ingest failed: \${res.status}\`);
  return res.json();
}

async function main() {
  // 1. Start a run (runId null → server creates one)
  const run = await emit(${create});
  const runId = run.runId;

  // 2. Append events
  await emit({
    runId, source: "Orchestrator", target: "LLM",
    type: "llm_call", label: "classify intent",
    payload: { prompt: "...", result: "refund_request" }, durationMs: 480,
  });
  await emit({
    runId, source: "Orchestrator", target: "lookup_order",
    type: "tool_call", label: "lookup_order(#4821)",
    payload: { args: { orderId: "4821" } }, durationMs: 310,
  });

  // 3. Close the run
  await emit({ runId, endRun: "completed" });
}

main().catch(console.error);`
}

function deepagentsSnippet({ origin, projectName, apiKey, local }: SnippetOpts) {
  if (local) {
    return `# pip install 'deepagents-trace[langchain]'
import agenttrace, agenttrace.langchain

agenttrace.set_tracking_uri(${q(origin)})
agenttrace.set_project(${q(projectName)})
agenttrace.langchain.autolog()   # every agent.invoke() becomes a run`
  }
  return `# pip install 'deepagents-trace[langchain]'
# export AGENTTRACE_TRACKING_URI=${q(origin)}
# export AGENTTRACE_KEY=${q(apiKey)}        # project-scoped key
import os
os.environ.setdefault("AGENTTRACE_TRACKING_URI", ${q(origin)})
os.environ.setdefault("AGENTTRACE_KEY", ${q(apiKey)})

import agenttrace.langchain

agenttrace.langchain.autolog()   # every agent.invoke() becomes a run`
}
