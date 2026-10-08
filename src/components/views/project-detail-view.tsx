"use client"

import { useEffect, useRef, useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { useNav } from "@/lib/store"
import type { RecentRun } from "@/lib/types"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog"
import { Chronogram } from "@/components/dashboard/chronogram"
import { RunFeed } from "@/components/dashboard/run-feed"
import { toast } from "sonner"
import { ArrowLeft, Plus } from "lucide-react"

interface Run {
  id: string
  name: string
  status: string
  startedAt: string
  endedAt: string | null
  _count?: { events: number }
}

interface ProjectDetail {
  id: string
  name: string
  description: string | null
  createdAt: string
  runs: Run[]
  apiKeys: { id: string; prefix: string; label: string | null; createdAt: string; lastUsedAt: string | null }[]
}

const WINDOWS = [
  { hours: 24, label: "24 h" },
  { hours: 168, label: "7 d" },
] as const

const POLL_MS = 5000
const FEED_LIMIT = 24

/** Polls the project's newest run (a one-row query) every 5 s and, when it
 * changes (a new run, or one that finished), refreshes the project, its
 * chronogram and its feed, so a run started elsewhere shows up without navigating. */
function useNewRunWatch(projectId: string) {
  const qc = useQueryClient()
  const { data } = useQuery<{ runs: RecentRun[] }>({
    queryKey: ["runs-recent", projectId, 1],
    queryFn: () => api(`/api/runs/recent?projectId=${encodeURIComponent(projectId)}&limit=1`),
    refetchInterval: POLL_MS,
  })
  const latest = data?.runs[0]
  const signature = data ? `${latest?.id ?? ""}:${latest?.status ?? ""}` : null
  const seen = useRef<string | null>(null)
  useEffect(() => {
    if (signature === null) return
    if (seen.current !== null && seen.current !== signature) {
      qc.invalidateQueries({ queryKey: ["project", projectId] })
      qc.invalidateQueries({ queryKey: ["timeline", projectId] })
      qc.invalidateQueries({ queryKey: ["runs-recent", projectId, FEED_LIMIT] })
      qc.invalidateQueries({ queryKey: ["stats"] })
    }
    seen.current = signature
  }, [signature, projectId, qc])
}


export function ProjectDetailView() {
  const { projectId, go } = useNav()

  if (!projectId) {
    return (
      <div className="p-4 sm:p-6">
        <Button variant="ghost" size="sm" onClick={() => go("projects", { projectId: null })} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" /> Projects
        </Button>
        <p className="mt-8 text-center text-sm text-[var(--ink-2)]">
          No project selected. Pick one from the projects list.
        </p>
      </div>
    )
  }
  return <ProjectDetailBody key={projectId} projectId={projectId} />
}

function ProjectDetailBody({ projectId }: { projectId: string }) {
  const { go } = useNav()
  const qc = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [runName, setRunName] = useState("")
  const [hours, setHours] = useState<number>(24)

  const { data, isLoading, isError, refetch } = useQuery<{ project: ProjectDetail }>({
    queryKey: ["project", projectId],
    queryFn: () => api(`/api/projects/${projectId}`),
    // While one of its runs is running, keep the run count and statuses current.
    refetchInterval: (q) => (q.state.data?.project.runs.some((r) => r.status === "running") ? POLL_MS : false),
  })
  useNewRunWatch(projectId)

  const createRunMut = useMutation({
    mutationFn: (name: string) =>
      api<{ run: Run }>(`/api/projects/${projectId}/runs`, { method: "POST", json: { name } }),
    onSuccess: (data) => {
      for (const key of [["project", projectId], ["timeline", projectId], ["runs-recent"], ["stats"]]) {
        qc.invalidateQueries({ queryKey: key })
      }
      toast.success("Run started, listening for events")
      setCreateOpen(false)
      setRunName("")
      go("run", { runId: data.run.id })
    },
    onError: (e) => toast.error(`Couldn't start the run: ${(e as Error).message}`),
  })

  const project = data?.project
  const runCount = project?.runs.length ?? 0
  const keyCount = project?.apiKeys.length ?? 0

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      <Button variant="ghost" size="sm" onClick={() => go("projects", { projectId: null })} className="-ml-2 gap-1.5">
        <ArrowLeft className="h-4 w-4" /> Projects
      </Button>

      {isError ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-panel)] border border-[var(--line)] px-4 py-3 text-sm text-[var(--ink-2)]">
          <span>
            Couldn't load this project. It may have been deleted; otherwise check that the AgentTrace server is
            running, then retry.
          </span>
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      ) : isLoading || !project ? (
        <div className="space-y-3">
          <Skeleton className="h-8 w-64 rounded-[var(--radius-control)]" />
          <Skeleton className="h-4 w-96 max-w-full rounded-[var(--radius-control)]" />
        </div>
      ) : (
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-semibold text-[var(--ink)]" title={project.name}>
              {project.name}
            </h1>
            <p className={cn("mt-1 max-w-2xl text-sm", project.description ? "text-[var(--ink-2)]" : "text-[var(--ink-3)]")}>
              {project.description || "No description"}
            </p>
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[var(--ink-2)]">
              <span>
                <span className="font-mono tabular-nums text-[var(--ink)]">{runCount}</span>{" "}
                {runCount === 1 ? "run" : "runs"}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                <span className="font-mono tabular-nums text-[var(--ink)]">{keyCount}</span> API{" "}
                {keyCount === 1 ? "key" : "keys"}
              </span>
              <button
                type="button"
                className="rounded-[var(--radius-control)] text-[var(--action)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                onClick={() => go("integration", { projectId: project.id })}
              >
                Manage API keys
              </button>
            </p>
          </div>
          <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5">
            <Plus className="h-4 w-4" />
            Start a run
          </Button>
        </header>
      )}

      {!isError && (
        <>
          <Chronogram
            projectId={projectId}
            hours={hours}
            controls={<WindowToggle hours={hours} onChange={setHours} />}
          />
          <RunFeed projectId={projectId} limit={FEED_LIMIT} />
        </>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start a run</DialogTitle>
            <DialogDescription>
              This creates a run in {project?.name ?? "this project"} and opens its live view. Events you send with
              the project's API key appear there as they arrive.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Input
              value={runName}
              onChange={(e) => setRunName(e.target.value)}
              placeholder="Run name (e.g. refund order #4821)"
              aria-label="Run name"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && runName.trim()) createRunMut.mutate(runName.trim())
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => createRunMut.mutate(runName.trim() || "Untitled run")} disabled={createRunMut.isPending}>
              {createRunMut.isPending ? "Starting…" : "Start run"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** 24 h / 7 d: the chronogram's window. */
function WindowToggle({ hours, onChange }: { hours: number; onChange: (hours: number) => void }) {
  return (
    <div
      role="group"
      aria-label="Time window"
      className="inline-flex overflow-hidden rounded-[var(--radius-control)] border border-[var(--line-strong)]"
    >
      {WINDOWS.map((w, i) => {
        const on = w.hours === hours
        return (
          <button
            key={w.hours}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(w.hours)}
            className={cn(
              "px-2.5 py-1 font-mono text-[12px] tabular-nums transition-colors duration-150 motion-reduce:transition-none",
              "focus-visible:relative focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
              i > 0 && "border-l border-[var(--line-strong)]",
              on ? "bg-[var(--action)] text-[var(--on-action)]" : "text-[var(--ink-2)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]",
            )}
          >
            {w.label}
          </button>
        )
      })}
    </div>
  )
}
