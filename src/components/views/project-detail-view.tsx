"use client"

import { LoadError } from "@/components/load-error"
import { useEffect, useMemo, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { api, formatDuration, formatRelative } from "@/lib/api"
import { useNav } from "@/lib/store"
import { RUN_STATUS, type RecentRun, type RunStatus } from "@/lib/types"
import {
  DEFAULT_RUN_SORT,
  RUN_SORT_KEYS,
  RUN_SORTS,
  describeRunSort,
  runDurationMs,
  sortRuns,
  type RunSortKey,
  type SortDirection,
} from "@/lib/run-sort"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Chronogram } from "@/components/dashboard/chronogram"
import { RunFeed } from "@/components/dashboard/run-feed"
import { ArrowDownWideNarrow, ArrowLeft, ArrowUpNarrowWide, ChevronRight, Search } from "lucide-react"

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
  { hours: 24, label: "24 h", name: "Last 24 hours" },
  { hours: 168, label: "7 d", name: "Last 7 days" },
] as const
const PAGE = 25

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
  const [hours, setHours] = useState<number>(24)

  const { data, isLoading, isError, refetch } = useQuery<{ project: ProjectDetail }>({
    queryKey: ["project", projectId],
    queryFn: () => api(`/api/projects/${projectId}`),
    // While one of its runs is running, keep the run count and statuses current.
    refetchInterval: (q) => (q.state.data?.project.runs.some((r) => r.status === "running") ? POLL_MS : false),
  })
  useNewRunWatch(projectId)

  const project = data?.project
  const runCount = project?.runs.length ?? 0
  const keyCount = project?.apiKeys.length ?? 0

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      <Button variant="ghost" size="sm" onClick={() => go("projects", { projectId: null })} className="-ml-2 gap-1.5">
        <ArrowLeft className="h-4 w-4" /> Projects
      </Button>

      {isError ? (
        <LoadError what="this project" onRetry={refetch} />
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
        </header>
      )}

      {/* Runs come from the agent (the SDK or POST /api/events), never from this page. */}
      {!isError && (
        <>
          <Chronogram
            projectId={projectId}
            hours={hours}
            controls={<WindowToggle hours={hours} onChange={setHours} />}
          />
          <RunFeed projectId={projectId} limit={FEED_LIMIT} />
          {project && project.runs.length > 0 && <AllRuns projectId={projectId} runs={project.runs} />}
        </>
      )}
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
            aria-label={w.name}
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

function runDuration(r: Run): string {
  const ms = runDurationMs(r)
  if (ms !== null) return formatDuration(ms)
  return r.status === "running" ? "running" : "—"
}

/** Every run of the project behind a disclosure (the feed and the chronogram
 * only reach the latest 24 runs and the last 7 days), newest first unless
 * sorted otherwise. */
function AllRuns({ projectId, runs }: { projectId: string; runs: Run[] }) {
  const { go } = useNav()
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState("")
  const [shown, setShown] = useState(PAGE)
  const [sortKey, setSortKey] = useState<RunSortKey>(DEFAULT_RUN_SORT.key)
  const [direction, setDirection] = useState<SortDirection>(DEFAULT_RUN_SORT.direction)
  const sorted = useMemo(() => sortRuns(runs, sortKey, direction), [runs, sortKey, direction])
  const needle = filter.trim().toLowerCase()
  const matching = needle ? sorted.filter((r) => r.name.toLowerCase().includes(needle)) : sorted
  const visible = matching.slice(0, shown)
  const panelId = "all-runs-panel"
  const sortLabelId = "all-runs-sort-label"
  const sort = RUN_SORTS[sortKey]
  const DirectionIcon = direction === "desc" ? ArrowDownWideNarrow : ArrowUpNarrowWide

  return (
    <section aria-labelledby="all-runs-title" className="space-y-3">
      <h2 id="all-runs-title" className="text-base font-semibold text-[var(--ink)]">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
        >
          <ChevronRight
            aria-hidden="true"
            className={cn("h-4 w-4 text-[var(--ink-2)] transition-transform duration-150 motion-reduce:transition-none", open && "rotate-90")}
          />
          All runs
          <span className="font-mono text-[12px] font-normal tabular-nums text-[var(--ink-2)]">{runs.length}</span>
        </button>
      </h2>
      {open && (
        <div id={panelId} className="space-y-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="relative w-full sm:w-80">
              <Search aria-hidden="true" className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ink-2)]" />
              <Input
                placeholder="Filter runs by name"
                aria-label="Filter runs by name"
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value)
                  setShown(PAGE)
                }}
                className="h-9 pl-9"
              />
            </div>
            <div className="flex items-center gap-2">
              <span id={sortLabelId} className="text-[12px] text-[var(--ink-2)]">
                Sort by
              </span>
              <Select value={sortKey} onValueChange={(v) => setSortKey(v as RunSortKey)}>
                <SelectTrigger aria-labelledby={sortLabelId} className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RUN_SORT_KEYS.map((key) => (
                    <SelectItem key={key} value={key}>
                      {RUN_SORTS[key].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/* Says the current order; pressing it reverses the order. */}
              <Button
                variant="outline"
                title="Reverse the order"
                onClick={() => setDirection((d) => (d === "desc" ? "asc" : "desc"))}
                className="gap-1.5 px-3 font-normal"
              >
                <DirectionIcon aria-hidden="true" className="size-4 text-[var(--ink-2)]" />
                {sort[direction]}
              </Button>
            </div>
            {/* The direction button's new label is not read out on its own. */}
            <p role="status" className="sr-only">
              {describeRunSort(sortKey, direction)}
            </p>
          </div>
          {matching.length === 0 ? (
            <p className="text-[13px] text-[var(--ink-2)]">No runs match "{filter.trim()}".</p>
          ) : (
            <ul className="divide-y divide-[var(--line)] overflow-hidden rounded-[var(--radius-panel)] border border-[var(--line)] bg-[var(--surface-1)]">
              {visible.map((r) => {
                const status = RUN_STATUS[r.status as RunStatus] ?? RUN_STATUS.completed
                const events = r._count?.events ?? 0
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => go("run", { runId: r.id, projectId })}
                      className="flex w-full min-w-0 items-center gap-3 px-3 py-2 text-left text-[13px] hover:bg-[var(--surface-2)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                    >
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: status.color }} />
                      <span className="sr-only">{status.label}</span>
                      <span className="min-w-0 flex-1 truncate text-[var(--ink)]" title={r.name}>
                        {r.name}
                      </span>
                      <span className="hidden shrink-0 font-mono text-[12px] tabular-nums text-[var(--ink-2)] sm:inline">
                        {events === 1 ? "1 event" : `${events} events`}
                      </span>
                      <span className="w-14 shrink-0 text-right font-mono text-[12px] tabular-nums text-[var(--ink-2)]">
                        {runDuration(r)}
                      </span>
                      <span className="w-16 shrink-0 text-right text-[12px] text-[var(--ink-2)]">{formatRelative(r.startedAt)}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          {matching.length > shown && (
            <div className="flex items-center gap-3">
              <Button size="sm" variant="outline" onClick={() => setShown((n) => n + PAGE)}>
                Load more
              </Button>
              <span className="text-[12px] text-[var(--ink-2)]">
                Showing {visible.length} of {matching.length}
              </span>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
