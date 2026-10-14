"use client"

import { LoadError } from "@/components/load-error"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api, formatDuration } from "@/lib/api"
import { useNav } from "@/lib/store"
import { SequenceDiagram, type RunStats } from "@/components/sequence-diagram/sequence-diagram"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { toast } from "sonner"
import { ArrowLeft, Trash2, StopCircle, CheckCircle2, XCircle, ChevronDown } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { RUN_STATUS, type RunStatus, type TraceEvent } from "@/lib/types"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface RunDetail {
  id: string
  name: string
  status: string
  startedAt: string
  endedAt: string | null
  project: { id: string; name: string; userId: string }
  events: TraceEvent[]
}

export function RunView() {
  const { runId, go } = useNav()
  const qc = useQueryClient()
  const [deleting, setDeleting] = useState(false)
  // The diagram's merged event list (live events included), tagged with its run.
  const [stats, setStats] = useState<(RunStats & { runId: string }) | null>(null)
  const onStats = useCallback(
    (s: RunStats) => {
      if (runId) setStats({ ...s, runId })
    },
    [runId]
  )

  const { data, isLoading, isError, refetch } = useQuery<{ run: RunDetail }>({
    queryKey: ["run", runId],
    queryFn: () => api(`/api/runs/${runId}`),
    enabled: !!runId,
    // keep polling while running so a closed socket still catches status updates
    refetchInterval: (q) => {
      const r = (q.state.data as any)?.run
      return r && r.status === "running" ? 5000 : false
    },
  })

  // Stable across renders unless the refetched run's events change, so the
  // diagram only re-merges when there is something new.
  const rawEvents = data?.run.events
  const events = useMemo(
    () => (rawEvents ?? []).map((e) => ({ ...e, payload: safeParse(e.payload) })),
    [rawEvents]
  )

  // When the run ends — seen over /ws (which invalidates the run query) or
  // by the polling refetch alone — refresh the aggregate views once.
  const runStatus = data?.run.status
  const prevRunStatus = useRef(runStatus)
  useEffect(() => {
    const prev = prevRunStatus.current
    prevRunStatus.current = runStatus
    if (prev === "running" && runStatus && runStatus !== "running") {
      qc.invalidateQueries({ queryKey: ["stats"] })
    }
  }, [runStatus, qc])

  const updateStatusMut = useMutation({
    mutationFn: (vars: { status: "completed" | "failed" }) =>
      api<{ run: RunDetail }>(`/api/runs/${runId}`, { method: "PATCH", json: vars }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["run", runId] })
      qc.invalidateQueries({ queryKey: ["stats"] })
      qc.invalidateQueries({ queryKey: ["project"] })
      toast.success(`Run marked as ${vars.status}`)
    },
  })

  const deleteMut = useMutation({
    mutationFn: () => api(`/api/runs/${runId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stats"] })
      qc.invalidateQueries({ queryKey: ["project"] })
      toast.success("Run deleted")
      if (data?.run.project.id) go("project", { projectId: data.run.project.id })
      else go("projects", { projectId: null, runId: null })
    },
  })

  if (!runId) {
    return (
      <div className="p-6">
        <Button variant="ghost" size="sm" onClick={() => go("projects")} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
      </div>
    )
  }

  if (isError && !data) {
    return (
      <div className="p-4 sm:p-6 space-y-4">
        <Button variant="ghost" size="sm" onClick={() => go("projects")} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <LoadError what="this run" onRetry={refetch} />
      </div>
    )
  }

  if (isLoading || !data) {
    return (
      <div className="h-full flex flex-col">
        <div className="p-4 border-b border-border">
          <Skeleton className="h-6 w-72" />
        </div>
        <div className="flex-1 at-canvas flex items-center justify-center">
          <Skeleton className="h-64 w-full max-w-3xl" />
        </div>
      </div>
    )
  }

  const run = data.run
  // Counted from the diagram's merged list, so the header keeps up with live events.
  const own = stats?.runId === run.id ? stats : null
  const count = own?.count ?? events.length
  const lastAt = own ? own.lastTimestamp : (events.at(-1)?.timestamp ?? null)
  const end = run.endedAt ?? lastAt
  const dur = end ? Math.max(0, new Date(end).getTime() - new Date(run.startedAt).getTime()) : null
  const toProject = () => go("project", { projectId: run.project.id, runId: null })

  return (
    <div className="h-full flex flex-col">
      {/* run header */}
      <header className="border-b border-[var(--line)] px-3 sm:px-4 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 min-h-14">
        <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={toProject}
            className="h-8 shrink-0 gap-1.5 px-2 text-[var(--ink-2)] hover:text-[var(--ink)] max-w-[40%]"
            title={`Back to ${run.project.name}`}
            aria-label={`Back to ${run.project.name}`}
          >
            <ArrowLeft aria-hidden className="h-4 w-4 shrink-0" />
            <span className="hidden sm:inline truncate">{run.project.name}</span>
          </Button>
          <span aria-hidden className="hidden sm:inline text-[var(--ink-3)]">/</span>
          <h1 className="min-w-0 truncate text-sm font-semibold text-[var(--ink)]" title={run.name}>
            {run.name}
          </h1>
          <RunStatusBadge status={run.status} />
        </nav>

        <p className="order-last w-full pl-1 font-mono text-[11px] tabular-nums text-[var(--ink-2)] sm:order-none sm:w-auto sm:pl-0">
          {count} {count === 1 ? "event" : "events"}
          {dur != null && <span className="text-[var(--ink-3)]"> · </span>}
          {dur != null && formatDuration(dur)}
        </p>

        <div className="flex items-center gap-1.5">
          {run.status === "running" && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 h-8" aria-label="Close run">
                  <StopCircle className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Close run</span>
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => updateStatusMut.mutate({ status: "completed" })}>
                  <CheckCircle2 className="mr-2 h-3.5 w-3.5" style={{ color: RUN_STATUS.completed.color }} />
                  Mark completed
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => updateStatusMut.mutate({ status: "failed" })}>
                  <XCircle className="mr-2 h-3.5 w-3.5" style={{ color: RUN_STATUS.failed.color }} />
                  Mark failed
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-[var(--ink-2)] hover:text-[var(--danger)]"
            onClick={() => setDeleting(true)}
            title="Delete run"
            aria-label="Delete run"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* the diagram */}
      <div className="flex-1 min-h-0">
        <SequenceDiagram
          key={run.id}
          runId={run.id}
          runName={run.name}
          projectName={run.project.name}
          startedAt={run.startedAt}
          endedAt={run.endedAt}
          initialEvents={events}
          initialStatus={run.status as any}
          onRunUpdate={() => qc.invalidateQueries({ queryKey: ["run", runId] })}
          onStats={onStats}
        />
      </div>

      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this run?</AlertDialogTitle>
            <AlertDialogDescription>
              "{run.name}" and all {count} events will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteMut.mutate()}
            >
              Delete run
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** The run's status: a dot (pulsing while running) and border in its --st-* colour, the label in ink. */
function RunStatusBadge({ status }: { status: string }) {
  const st = RUN_STATUS[status as RunStatus] ?? { label: status, color: "var(--ink-3)" }
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] leading-4 text-[var(--ink)]"
      style={{ borderColor: `color-mix(in oklab, ${st.color} 55%, transparent)` }}
    >
      <span aria-hidden className="relative flex size-1.5">
        {status === "running" && (
          <span className="at-pulse-ring absolute inline-flex size-full rounded-full" style={{ background: st.color }} />
        )}
        <span className="relative inline-flex size-1.5 rounded-full" style={{ background: st.color }} />
      </span>
      {st.label}
    </span>
  )
}

function safeParse(s: any): any {
  if (typeof s !== "string") return s
  try {
    return JSON.parse(s)
  } catch {
    return s
  }
}
