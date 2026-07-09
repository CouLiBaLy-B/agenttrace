"use client"

import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api, formatRelative } from "@/lib/api"
import { useNav } from "@/lib/store"
import { Card } from "@/components/ui/card"
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
import {
  Plus,
  FolderGit2,
  ArrowRight,
  Trash2,
  Pencil,
  Activity,
  Sparkles,
} from "lucide-react"

interface Project {
  id: string
  name: string
  description: string | null
  createdAt: string
  _count: { runs: number }
  runs: { id: string; name: string; status: string; startedAt: string }[]
}

export function ProjectsView() {
  const { go } = useNav()
  const qc = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<Project | null>(null)
  const [deleting, setDeleting] = useState<Project | null>(null)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")

  const { data, isLoading } = useQuery<{ projects: Project[] }>({
    queryKey: ["projects"],
    queryFn: () => api("/api/projects"),
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

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {"// workspaces"}
          </p>
          <h1 className="text-2xl font-semibold mt-0.5">Projects</h1>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5">
          <Plus className="h-4 w-4" />
          New project
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <EmptyProjects
          onCreate={() => {
            setCreateOpen(true)
          }}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {projects.map((p) => (
            <Card
              key={p.id}
              className="p-4 hover:border-primary/40 cursor-pointer transition-colors group"
              onClick={() => go("project", { projectId: p.id })}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <div className="h-9 w-9 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                    <FolderGit2 className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium truncate">{p.name}</p>
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                      {p.description || "No description"}
                    </p>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
              </div>
              <div className="mt-3 pt-3 border-t border-border flex items-center gap-3 text-xs">
                <span className="font-mono text-muted-foreground flex items-center gap-1">
                  <Activity className="h-3 w-3" />
                  {p._count.runs} runs
                </span>
                <span className="font-mono text-muted-foreground ml-auto">
                  {formatRelative(p.runs[0]?.startedAt || p.createdAt)}
                </span>
                <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    onClick={() => openEdit(p)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-red-400"
                    onClick={() => setDeleting(p)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
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
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
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

function EmptyProjects({ onCreate }: { onCreate: () => void }) {
  return (
    <Card className="p-10 at-graticule at-scanlines relative overflow-hidden text-center">
      <div className="relative z-10 max-w-md mx-auto">
        <div className="h-16 w-16 mx-auto rounded-full border border-primary/30 flex items-center justify-center">
          <Sparkles className="h-7 w-7 text-primary at-glow" />
        </div>
        <h3 className="mt-6 text-lg font-medium">No projects yet</h3>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Create your first project to get an ingestion API key, then point your agent at it and
          watch events stream into a live sequence diagram.
        </p>
        <Button onClick={onCreate} className="mt-5 gap-1.5">
          <Plus className="h-4 w-4" />
          Create your first project
        </Button>
      </div>
    </Card>
  )
}
