"use client"

import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api, formatRelative } from "@/lib/api"
import { useNav } from "@/lib/store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
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
import { Plus, Trash2, Pencil } from "lucide-react"
import { useElementWidth } from "@/lib/hooks"
import type { RecentRun, RunShape } from "@/lib/types"
import { cn } from "@/lib/utils"
import { MiniDiagram } from "@/components/mini-diagram/mini-diagram"
import { useSeedDemo, useTileClass } from "@/components/dashboard/run-feed"
import type { DashboardStats } from "@/components/dashboard/stat-strip"

interface Project {
  id: string
  name: string
  description: string | null
  createdAt: string
  _count?: { runs: number }
  runs?: { id: string; name: string; status: string; startedAt: string }[]
}

export function ProjectsView() {
  const { go } = useNav()
  const qc = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<Project | null>(null)
  const [deleting, setDeleting] = useState<Project | null>(null)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")

  const { data, isLoading, isError, refetch } = useQuery<{ projects: Project[] }>({
    queryKey: ["projects"],
    queryFn: () => api("/api/projects"),
  })
  // Run count, success rate and last activity per project (shared with the dashboard).
  const { data: stats, isLoading: statsLoading } = useQuery<DashboardStats>({
    queryKey: ["stats"],
    queryFn: () => api("/api/stats"),
  })

  const createMut = useMutation({
    mutationFn: (vars: { name: string; description: string }) =>
      api<{ project: Project }>("/api/projects", { method: "POST", json: vars }),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: ["projects"] })
      const prev = qc.getQueryData<{ projects: Project[] }>(["projects"])
      const optimistic: Project = {
        id: `temp-${Date.now()}`,
        name: vars.name,
        description: vars.description,
        createdAt: new Date().toISOString(),
        _count: { runs: 0 },
        runs: [],
      }
      qc.setQueryData<{ projects: Project[] }>(["projects"], (old) => ({
        projects: [optimistic, ...(old?.projects || [])],
      }))
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      qc.setQueryData(["projects"], ctx?.prev)
      toast.error("Couldn't create the project — rolled back. " + (_e as Error).message)
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["projects"] })
      qc.invalidateQueries({ queryKey: ["stats"] })
      toast.success("Project created — an API key was generated")
      setCreateOpen(false)
      setName("")
      setDescription("")
      go("project", { projectId: data.project.id })
    },
  })

  const renameMut = useMutation({
    mutationFn: (vars: { id: string; name: string; description: string }) =>
      api<{ project: Project }>(`/api/projects/${vars.id}`, {
        method: "PATCH",
        json: { name: vars.name, description: vars.description },
      }),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: ["projects"] })
      const prev = qc.getQueryData<{ projects: Project[] }>(["projects"])
      qc.setQueryData<{ projects: Project[] }>(["projects"], (old) => ({
        projects: (old?.projects || []).map((p) =>
          p.id === vars.id ? { ...p, name: vars.name, description: vars.description } : p
        ),
      }))
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      qc.setQueryData(["projects"], ctx?.prev)
      toast.error("Rename failed — reverted. " + (_e as Error).message)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] })
      qc.invalidateQueries({ queryKey: ["stats"] })
      toast.success("Project updated")
      setEditing(null)
    },
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => api(`/api/projects/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] })
      qc.invalidateQueries({ queryKey: ["stats"] })
      toast.success("Project deleted")
      setDeleting(null)
    },
    onError: (e) => toast.error("Delete failed: " + (e as Error).message),
  })

  const submitCreate = () => {
    if (!name.trim()) {
      toast.error("Give your project a name")
      return
    }
    createMut.mutate({ name: name.trim(), description: description.trim() })
  }

  const submitRename = () => {
    if (!editing) return
    if (!name.trim()) {
      toast.error("Name can't be empty")
      return
    }
    renameMut.mutate({ id: editing.id, name: name.trim(), description: description.trim() })
  }

  const openEdit = (p: Project) => {
    setEditing(p)
    setName(p.name)
    setDescription(p.description || "")
  }

  const projects = data?.projects || []
  const perProject = new Map((stats?.perProject ?? []).map((row) => [row.id, row]))

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-[var(--ink)]">Projects</h1>
          {projects.length > 0 && (
            <p className="mt-0.5 text-[13px] text-[var(--ink-2)]">
              {projects.length === 1 ? "1 project" : `${projects.length} projects`}, each with its last run
            </p>
          )}
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5">
          <Plus className="h-4 w-4" />
          New project
        </Button>
      </div>

      {isLoading ? (
        <div className={GRID}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[196px] rounded-[var(--radius-panel)]" />
          ))}
        </div>
      ) : isError ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-panel)] border border-[var(--line)] px-4 py-3 text-sm text-[var(--ink-2)]">
          <span>Couldn't load your projects. Check that the AgentTrace server is running, then retry.</span>
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      ) : projects.length === 0 ? (
        <EmptyProjects onCreate={() => setCreateOpen(true)} />
      ) : (
        <ul className={GRID} aria-label="Projects">
          {projects.map((p) => (
            <li key={p.id} className="min-w-0">
              <ProjectCard
                project={p}
                stats={perProject.get(p.id)}
                statsLoading={statsLoading}
                onOpen={() => go("project", { projectId: p.id })}
                onEdit={() => openEdit(p)}
                onDelete={() => setDeleting(p)}
              />
            </li>
          ))}
        </ul>
      )}

      {/* create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>
              A project groups runs from one agent. We'll generate an API key you can use to
              stream events.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="pname">Name</Label>
              <Input
                id="pname"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Customer Support Agent"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pdesc">Description (optional)</Label>
              <Textarea
                id="pdesc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does this agent do?"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitCreate} disabled={createMut.isPending}>
              {createMut.isPending ? "Creating…" : "Create project"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* rename dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit project</DialogTitle>
            <DialogDescription>Update the name or description.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="ename">Name</Label>
              <Input id="ename" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edesc">Description</Label>
              <Textarea
                id="edesc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={submitRename} disabled={renameMut.isPending}>
              {renameMut.isPending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* delete confirm */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleting?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the project and all of its runs and events. This can't be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[var(--danger)] text-[var(--on-danger)] hover:bg-[color-mix(in_oklab,var(--danger)_90%,transparent)]"
              onClick={() => deleting && deleteMut.mutate(deleting.id)}
            >
              Delete project
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

const GRID = "grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
const DIAGRAM_H = 88
/** Three bare lifelines: where the last run will be drawn once it loads. */
const PLACEHOLDER: RunShape = { participants: ["", "", ""], events: [] }


/** The project's last run as a mini diagram: lifelines while it loads, a note when there is none. */
function LastRun({ projectId, width }: { projectId: string; width: number }) {
  const { data, isLoading, isError } = useQuery<{ runs: RecentRun[] }>({
    queryKey: ["runs-recent", projectId, 1],
    queryFn: () => api(`/api/runs/recent?projectId=${encodeURIComponent(projectId)}&limit=1`),
    enabled: !projectId.startsWith("temp-"),
  })
  const run = data?.runs[0]
  if (width === 0) return null
  if (run) return <MiniDiagram shape={run.shape} width={width} height={DIAGRAM_H} />
  if (isLoading && !projectId.startsWith("temp-")) {
    return (
      <span className="block animate-pulse motion-reduce:animate-none">
        <MiniDiagram shape={PLACEHOLDER} width={width} height={DIAGRAM_H} />
      </span>
    )
  }
  return (
    <span className="flex h-full items-center justify-center text-[12px] text-[var(--ink-2)]">
      {isError ? "Couldn't load the last run" : "No runs yet"}
    </span>
  )
}

function ProjectCard({
  project: p,
  stats,
  statsLoading,
  onOpen,
  onEdit,
  onDelete,
}: {
  project: Project
  stats: DashboardStats["perProject"][number] | undefined
  statsLoading: boolean
  onOpen: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const [well, width] = useElementWidth<HTMLDivElement>()
  const tile = useTileClass()
  const runCount = stats?.runs ?? p._count?.runs ?? 0
  const lastRunAt = stats?.lastRunAt ?? p.runs?.[0]?.startedAt ?? null
  return (
    <div
      className={cn(
        tile,
        "relative flex h-full flex-col",
        // the card is a div: show the ring when its stretched name button has keyboard focus
        "has-[[data-open]:focus-visible]:outline-2 has-[[data-open]:focus-visible]:outline-offset-2 has-[[data-open]:focus-visible]:outline-[var(--focus-ring)]",
      )}
    >
      <div ref={well} aria-hidden="true" className="at-canvas border-b border-[var(--line)]" style={{ height: DIAGRAM_H }}>
        <LastRun projectId={p.id} width={width} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col px-3 py-2.5">
        <div className="flex min-w-0 items-start gap-2">
          <h2 className="min-w-0 flex-1 text-sm font-medium leading-6 text-[var(--ink)]">
            {/* The whole card opens the project; the name is the link that does it. */}
            <button
              type="button"
              data-open
              onClick={onOpen}
              title={p.name}
              className="block max-w-full truncate text-left outline-none after:absolute after:inset-0 after:content-['']"
            >
              {p.name}
            </button>
          </h2>
          <div className="relative z-10 -mr-1 flex shrink-0 items-center">
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Edit ${p.name}`}
              className="h-7 w-7 text-[var(--ink-2)] hover:text-[var(--ink)]"
              onClick={onEdit}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Delete ${p.name}`}
              className="h-7 w-7 text-[var(--ink-2)] hover:text-[var(--danger)]"
              onClick={onDelete}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <p className={cn("mt-0.5 line-clamp-2 text-[13px] leading-5", p.description ? "text-[var(--ink-2)]" : "text-[var(--ink-3)]")}>
          {p.description || "No description"}
        </p>
        <dl className="mt-auto flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 pt-3 text-[12px] text-[var(--ink-2)]">
          <div className="flex items-baseline gap-1">
            <dt className="sr-only">Runs</dt>
            <dd>
              <span className="font-mono tabular-nums text-[var(--ink)]">{runCount}</span> {runCount === 1 ? "run" : "runs"}
            </dd>
          </div>
          <div className="flex items-baseline gap-1">
            <dt className="sr-only">Success rate</dt>
            <dd>
              <span className="font-mono tabular-nums text-[var(--ink)]">
                {statsLoading ? "…" : stats && stats.runs > 0 ? `${stats.successRate}%` : "—"}
              </span>{" "}
              success
            </dd>
          </div>
          <div className="ml-auto flex items-baseline gap-1">
            <dt className="sr-only">Last activity</dt>
            <dd className="tabular-nums">
              {lastRunAt ? `last run ${formatRelative(lastRunAt)}` : `created ${formatRelative(p.createdAt)}`}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  )
}

function EmptyProjects({ onCreate }: { onCreate: () => void }) {
  const seed = useSeedDemo()
  return (
    <div className="rounded-[var(--radius-panel)] border border-dashed border-[var(--line-strong)] px-6 py-12 text-center">
      <h2 className="text-base font-semibold text-[var(--ink)]">No projects yet.</h2>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-[var(--ink-2)]">
        A project groups the runs of one agent and gives it an API key. Create one, or load the demo projects to look
        around first.
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        <Button size="sm" onClick={onCreate} className="gap-1.5">
          <Plus className="h-4 w-4" />
          New project
        </Button>
        <Button size="sm" variant="outline" onClick={() => seed.mutate()} disabled={seed.isPending}>
          {seed.isPending ? "Loading demo projects…" : "Load demo projects"}
        </Button>
      </div>
    </div>
  )
}
