"use client"

import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api, formatDuration, formatRelative, formatTime } from "@/lib/api"
import { useNav } from "@/lib/store"
import { Card } from "@/components/ui/card"
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
import {
  ArrowLeft,
  Plus,
  Trash2,
  Search,
  ChevronRight,
  Radio,
  Cable,
} from "lucide-react"

interface Run {
  id: string
  name: string
  status: string
  startedAt: string
  endedAt: string | null
  _count: { events: number }
}

interface ProjectDetail {
  id: string
  name: string
  description: string | null
  createdAt: string
  runs: Run[]
  apiKeys: { id: string; prefix: string; label: string | null; createdAt: string; lastUsedAt: string | null }[]
}

export function ProjectDetailView() {
  const { projectId, go } = useNav()
  const qc = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [runName, setRunName] = useState("")
  const [deleting, setDeleting] = useState<Run | null>(null)
  const [filter, setFilter] = useState("")

  const { data, isLoading } = useQuery<{ project: ProjectDetail }>({
    queryKey: ["project", projectId],
    queryFn: () => api(`/api/projects/${projectId}`),
    enabled: !!projectId,
  })

  const createRunMut = useMutation({
    mutationFn: (name: string) =>
      api<{ run: Run }>(`/api/projects/${projectId}/runs`, { method: "POST", json: { name } }),
    onMutate: async (name) => {
      await qc.cancelQueries({ queryKey: ["project", projectId] })
      const prev = qc.getQueryData<{ project: ProjectDetail }>(["project", projectId])
      const optimistic: Run = {
        id: `temp-${Date.now()}`,
        name,
        status: "running",
        startedAt: new Date().toISOString(),
        endedAt: null,
        _count: { events: 0 },
      }
      qc.setQueryData<{ project: ProjectDetail }>(["project", projectId], (old) => {
        if (!old?.project) return old
        return { project: { ...old.project, runs: [optimistic, ...old.project.runs] } }
      })
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["project", projectId], ctx.prev)
      toast.error("Couldn't start the run — rolled back. " + (_e as Error).message)
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["project", projectId] })
      qc.invalidateQueries({ queryKey: ["stats"] })
      toast.success("Run started — listening for events")
      setCreateOpen(false)
      setRunName("")
      go("run", { runId: data.run.id })
    },
  })

  const deleteRunMut = useMutation({
    mutationFn: (id: string) => api(`/api/runs/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project", projectId] })
      qc.invalidateQueries({ queryKey: ["stats"] })
      toast.success("Run deleted")
      setDeleting(null)
    },
    onError: (e) => toast.error("Delete failed: " + (e as Error).message),
  })

  if (!projectId) {
    return (
      <div className="p-6">
        <Button variant="ghost" size="sm" onClick={() => go("projects", { projectId: null })} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" /> Back to projects
        </Button>
        <p className="mt-8 text-center text-muted-foreground">No project selected.</p>
      </div>
    )
  }

  const project = data?.project
  const runs = (project?.runs || []).filter((r) =>
    r.name.toLowerCase().includes(filter.toLowerCase())
  )

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => go("projects", { projectId: null })} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" /> Projects
        </Button>
      </div>

      {isLoading || !project ? (
        <ProjectDetailSkeleton />
      ) : (
        <>
          {/* header */}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold truncate">{project.name}</h1>
              <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
                {project.description || "No description"}
              </p>
              <div className="mt-2 flex items-center gap-3 font-mono text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Radio className="h-3 w-3" />
                  {project.runs.length} runs
                </span>
                <span className="flex items-center gap-1">
                  <Cable className="h-3 w-3" />
                  {project.apiKeys.length} API {project.apiKeys.length === 1 ? "key" : "keys"}
                </span>
                <button
                  className="text-primary hover:underline"
                  onClick={() => go("integration", { projectId: project.id })}
                >
                  manage keys →
                </button>
              </div>
            </div>
            <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5">
              <Plus className="h-4 w-4" />
              Start a run
            </Button>
          </div>

          {/* runs */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Filter runs…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="pl-9 h-9"
              />
            </div>
            <span className="font-mono text-[11px] text-muted-foreground ml-auto">
              {runs.length} shown
            </span>
          </div>

          {runs.length === 0 ? (
            <Card className="p-10 at-graticule at-scanlines relative overflow-hidden text-center">
              <div className="relative z-10 max-w-md mx-auto">
                <div className="relative h-20 w-20 mx-auto rounded-full border border-primary/30 flex items-center justify-center">
                  <div className="absolute inset-2 rounded-full border border-primary/20" />
                  <div className="absolute inset-0 rounded-full overflow-hidden">
                    <div
                      className="at-radar-sweep absolute top-1/2 left-1/2 h-1/2 w-1/2 origin-top-left"
                      style={{
                        background: "linear-gradient(to right, oklch(0.78 0.17 155 / 0.35), transparent)",
                        clipPath: "polygon(0 0, 100% 0, 0 100%)",
                      }}
                    />
                  </div>
                  <Radio className="h-5 w-5 text-primary at-glow" />
                </div>
                <h3 className="mt-5 text-base font-medium">Listening for your agent's first event</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  Start a run from the button above, or send a <code className="font-mono text-primary/80">POST /api/events</code> with this project's key. The first event renders instantly.
                </p>
                <Button className="mt-4 gap-1.5" onClick={() => setCreateOpen(true)}>
                  <Plus className="h-4 w-4" />
                  Start a run
                </Button>
              </div>
            </Card>
          ) : (
            <div className="space-y-1.5">
              {runs.map((r) => {
                const dur = r.endedAt ? new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime() : null
                return (
                  <Card
                    key={r.id}
                    className="px-4 py-3 hover:border-primary/40 cursor-pointer transition-colors group flex items-center gap-3"
                    onClick={() => go("run", { runId: r.id })}
                  >
                    <StatusDot status={r.status} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{r.name}</p>
                      <p className="text-[11px] text-muted-foreground font-mono">
                        {formatRelative(r.startedAt)} · {formatTime(r.startedAt)}
                      </p>
                    </div>
                    <div className="hidden sm:flex items-center gap-4 font-mono text-[11px] text-muted-foreground">
                      <span>{r._count?.events ?? 0} events</span>
                      <span>{formatDuration(dur)}</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-red-400 opacity-0 group-hover:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation()
                        setDeleting(r)
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                    <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                  </Card>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* create run dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start a run</DialogTitle>
            <DialogDescription>
              This creates a run in <code className="font-mono">{project?.name}</code> and opens the
              live trace view. Events streamed via the API will appear here in real time.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Input
              value={runName}
              onChange={(e) => setRunName(e.target.value)}
              placeholder="Run name (e.g. refund order #4821)"
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

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this run?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleting?.name}" and all of its events will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleting && deleteRunMut.mutate(deleting.id)}
            >
              Delete run
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export function StatusDot({ status }: { status: string }) {
  const color = status === "completed" ? "#34d399" : status === "failed" ? "#f87171" : "#fbbf24"
  return (
    <span className="relative flex h-2.5 w-2.5 shrink-0" title={status}>
      {status === "running" && (
        <span
          className="absolute inline-flex h-full w-full rounded-full opacity-60 at-pulse-ring"
          style={{ background: color }}
        />
      )}
      <span
        className="relative inline-flex h-2.5 w-2.5 rounded-full"
        style={{ background: color, boxShadow: `0 0 6px ${color}` }}
      />
    </span>
  )
}

function ProjectDetailSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-9 w-64" />
      <div className="space-y-1.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-14" />
        ))}
      </div>
    </div>
  )
}

