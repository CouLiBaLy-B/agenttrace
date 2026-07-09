"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api, formatDuration, formatTime } from "@/lib/api"
import { useNav } from "@/lib/store"
import { SequenceDiagram } from "@/components/sequence-diagram/sequence-diagram"
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
import { useState } from "react"
import { TraceEvent, EVENT_COLORS } from "@/lib/types"
import { StatusDot } from "./project-detail-view"
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

  const { data, isLoading } = useQuery<{ run: RunDetail }>({
    queryKey: ["run", runId],
    queryFn: () => api(`/api/runs/${runId}`),
    enabled: !!runId,
    // keep polling while running so a closed socket still catches status updates
    refetchInterval: (q) => {
      const r = (q.state.data as any)?.run
      return r && r.status === "running" ? 5000 : false
    },
  })

  const updateStatusMut = useMutation({
    mutationFn: (vars: { status: "completed" | "failed" }) =>
      api<{ run: RunDetail }>(`/api/runs/${runId}`, { method: "PATCH", json: vars }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["run", runId] })
      qc.invalidateQueries({ queryKey: ["stats"] })
      qc.invalidateQueries({ queryKey: ["project"] })
      toast.success("Run marked as " + "completed")
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

  if (isLoading || !data) {
    return (
      <div className="h-full flex flex-col">
        <div className="p-4 border-b border-border">
          <Skeleton className="h-6 w-72" />
        </div>
        <div className="flex-1 at-graticule flex items-center justify-center">
          <Skeleton className="h-64 w-full max-w-3xl" />
        </div>
      </div>
    )
  }

  const run = data.run
  const events = run.events.map((e) => ({ ...e, payload: safeParse(e.payload) }))
  const dur = run.endedAt ? new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime() : null

  return (
    <div className="h-full flex flex-col">
      {/* run header */}
      <div className="border-b border-border px-4 py-3 flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => go("project", { projectId: run.project.id, runId: null })} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" />
          <span className="hidden sm:inline">{run.project.name}</span>
        </Button>
        <div className="h-4 w-px bg-border" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <StatusDot status={run.status} />
            <h1 className="text-sm font-medium truncate">{run.name}</h1>
          </div>
          <p className="font-mono text-[10px] text-muted-foreground mt-0.5">
            {formatTime(run.startedAt)} → {run.endedAt ? formatTime(run.endedAt) : "live"}
            {dur != null && ` · ${formatDuration(dur)}`}
            {` · ${events.length} events`}
          </p>
        </div>

        {/* event legend */}
        <div className="hidden md:flex items-center gap-2.5">
          {(Object.keys(EVENT_COLORS) as (keyof typeof EVENT_COLORS)[]).map((t) => (
            <span key={t} className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: EVENT_COLORS[t].color, boxShadow: `0 0 4px ${EVENT_COLORS[t].color}` }}
              />
              {EVENT_COLORS[t].label}
            </span>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          {run.status === "running" && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 h-8">
                  <StopCircle className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Close run</span>
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => updateStatusMut.mutate({ status: "completed" })}>
                  <CheckCircle2 className="mr-2 h-3.5 w-3.5 text-emerald-400" />
                  Mark completed
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => updateStatusMut.mutate({ status: "failed" })}>
                  <XCircle className="mr-2 h-3.5 w-3.5 text-red-400" />
                  Mark failed
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-red-400"
            onClick={() => setDeleting(true)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* the diagram */}
      <div className="flex-1 min-h-0">
        <SequenceDiagram
          runId={run.id}
          initialEvents={events}
          initialStatus={run.status as any}
          onRunUpdate={() => {
            qc.invalidateQueries({ queryKey: ["run", runId] })
            qc.invalidateQueries({ queryKey: ["stats"] })
          }}
        />
      </div>

      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this run?</AlertDialogTitle>
            <AlertDialogDescription>
              "{run.name}" and all {events.length} events will be permanently removed.
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

function safeParse(s: any): any {
  if (typeof s !== "string") return s
  try {
    return JSON.parse(s)
  } catch {
    return s
  }
}
