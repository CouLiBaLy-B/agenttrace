"use client"

import { LoadError } from "@/components/load-error"
import { useMemo } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { api, formatDuration, formatRelative } from "@/lib/api"
import { useElementWidth } from "@/lib/hooks"
import { useNav } from "@/lib/store"
import { useTheme } from "@/lib/theme"
import { eventPaint, RUN_STATUS, type RecentRun } from "@/lib/types"
import { extractParticipants, shapeParticipants } from "@/lib/participant-kinds"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { LiveMiniDiagram, MiniDiagram, useLiveRunEvents } from "@/components/mini-diagram/mini-diagram"
import { KIND_COLOR, PARTICIPANT_ICON } from "@/components/sequence-diagram/participants"

const TILE_DIAGRAM_H = 88


/** Tile chrome: a button with the theme's hover (Studio raises, the dark themes
 * strengthen the border) and the focus ring. */
export function useTileClass() {
  const studio = useTheme((s) => s.resolved) === "studio"
  return cn(
    "group block w-full min-w-0 overflow-hidden text-left rounded-[var(--radius-panel)] border border-[var(--line)] bg-[var(--surface-1)]",
    "transition-[box-shadow,border-color] duration-150 motion-reduce:transition-none",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
    studio ? "hover:shadow-[var(--shadow-raised)]" : "hover:border-[var(--line-strong)]",
  )
}

function StatusDot({ status }: { status: RecentRun["status"] }) {
  const meta = RUN_STATUS[status] ?? RUN_STATUS.completed
  return (
    <span className="relative flex h-2 w-2 shrink-0">
      {status === "running" && (
        <span className="at-pulse-ring absolute inline-flex h-full w-full rounded-full" style={{ background: meta.color }} />
      )}
      <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: meta.color }} />
      <span className="sr-only">{meta.label}</span>
    </span>
  )
}

/** A tile's accessible name: "{name}, {status}, {project}, {duration}" (a
 * running run has no duration yet, so it says how long ago it started). */
function tileLabel(run: RecentRun): string {
  const status = (RUN_STATUS[run.status] ?? RUN_STATUS.completed).label.toLowerCase()
  const duration = run.durationMs != null ? formatDuration(run.durationMs) : `started ${formatRelative(run.startedAt)}`
  return `${run.name}, ${status}, ${run.project.name}, ${duration}`
}

function RunTile({ run, onOpen }: { run: RecentRun; onOpen: () => void }) {
  const [well, width] = useElementWidth<HTMLSpanElement>()
  return (
    <button type="button" onClick={onOpen} aria-label={tileLabel(run)} className={useTileClass()}>
      <span ref={well} className="at-canvas block border-b border-[var(--line)]" style={{ height: TILE_DIAGRAM_H }}>
        {width > 0 && <MiniDiagram shape={run.shape} width={width} height={TILE_DIAGRAM_H} />}
      </span>
      <span className="block px-3 py-2.5">
        <span className="flex min-w-0 items-center gap-2">
          <StatusDot status={run.status} />
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--ink)]" title={run.name}>
            {run.name}
          </span>
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-[var(--ink-2)]">
            {formatDuration(run.durationMs)}
          </span>
        </span>
        <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[12px] text-[var(--ink-2)]">
          <span className="min-w-0 truncate" title={run.project.name}>
            {run.project.name}
          </span>
          <span aria-hidden="true">·</span>
          <span className="shrink-0">{run.eventCount === 1 ? "1 event" : `${run.eventCount} events`}</span>
          <span className="ml-auto shrink-0">{formatRelative(run.startedAt)}</span>
        </span>
      </span>
    </button>
  )
}

const LIVE_RECENT = 4

/** The first running run, wide, drawing its events as they arrive; beside it
 * the run's participants and its last few events. */
function LiveTile({ run, onOpen }: { run: RecentRun; onOpen: () => void }) {
  const [well, width] = useElementWidth<HTMLSpanElement>()
  const events = useLiveRunEvents(run.id, false) // the live diagram below keeps this query current
  const count = Math.max(run.eventCount, events?.length ?? 0)
  const height = Math.round(width / 2)
  // Typed from all the run's events once they are loaded, from the feed's shape until then.
  const participants = useMemo(
    () => (events?.length ? extractParticipants(events) : shapeParticipants(run.shape)),
    [events, run.shape],
  )
  const recent = (events ?? []).slice(-LIVE_RECENT)
  return (
    <button type="button" onClick={onOpen} aria-label={tileLabel(run)} className={cn(useTileClass(), "sm:flex sm:items-stretch")}>
      <span ref={well} className="at-canvas block aspect-[2/1] w-full border-b border-[var(--line)] sm:w-1/2 sm:max-w-[520px] sm:border-r sm:border-b-0">
        {width > 0 && <LiveMiniDiagram runId={run.id} width={width} height={height} />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col justify-center gap-3 px-4 py-3">
        <span className="flex min-w-0 flex-col gap-1.5">
          <span
            className="inline-flex w-fit items-center gap-1.5 rounded-[var(--radius-control)] px-1.5 py-0.5 text-[12px] font-medium text-[var(--ev-handoff-text)]"
            style={{ background: "color-mix(in oklab, var(--ev-handoff) 6%, transparent)" }}
          >
            <StatusDot status="running" />
            Live, {count === 1 ? "1 event" : `${count} events`}
          </span>
          <span className="truncate text-base font-semibold text-[var(--ink)]" title={run.name}>
            {run.name}
          </span>
          <span className="truncate text-[13px] text-[var(--ink-2)]" title={run.project.name}>
            {run.project.name} · started {formatRelative(run.startedAt)}
          </span>
        </span>
        {participants.length > 0 && (
          <span
            className="block min-w-0 truncate font-mono text-[12px] text-[var(--ink-2)]"
            title={participants.map((p) => p.name).join(", ")}
          >
            {participants.map((p) => {
              const Icon = PARTICIPANT_ICON[p.kind]
              return (
                <span key={p.id} className="mr-3 last:mr-0">
                  <Icon aria-hidden className="mr-1 inline size-3 align-[-2px]" style={{ color: KIND_COLOR[p.kind] }} />
                  {p.name}
                </span>
              )
            })}
          </span>
        )}
        {recent.length > 0 && (
          <span className="block min-w-0 border-t border-[var(--line)] pt-2">
            <span className="block text-[12px] text-[var(--ink-2)]">Latest events</span>
            {recent.map((e) => {
              const paint = eventPaint(e.type, e.status === "error")
              return (
                <span key={e.id} className="mt-1 flex min-w-0 items-center gap-2 text-[12px]">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: paint.color }} />
                  <span className="max-w-[55%] shrink-0 truncate font-mono text-[var(--ink)]" title={`${e.source} → ${e.target}`}>
                    {e.source} → {e.target}
                  </span>
                  <span className="min-w-0 truncate text-[var(--ink-2)]" title={e.label || paint.label}>
                    {e.label || paint.label}
                  </span>
                </span>
              )
            })}
          </span>
        )}
      </span>
    </button>
  )
}

/** POSTs /api/seed and refreshes everything that lists projects or runs. */
export function useSeedDemo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api<{ seeded: number }>("/api/seed", { method: "POST" }),
    onSuccess: () => {
      for (const key of ["stats", "timeline", "runs-recent", "projects"]) qc.invalidateQueries({ queryKey: [key] })
    },
    onError: (e) => toast.error(`Couldn't load the demo projects: ${(e as Error).message}. Try again from Settings.`),
  })
}

/** No runs: how to start tracing, and a button that loads the demo projects. */
export function EmptyFeed() {
  const seed = useSeedDemo()
  return (
    <div className="rounded-[var(--radius-panel)] border border-dashed border-[var(--line-strong)] px-6 py-10 text-center">
      <p className="mx-auto max-w-md text-sm text-[var(--ink-2)]">
        No runs yet. Start your agent with{" "}
        <code className="font-mono text-[12px] text-[var(--ink)]">agenttrace.langchain.autolog()</code> and runs appear
        here live.
      </p>
      <Button size="sm" variant="outline" className="mt-4" onClick={() => seed.mutate()} disabled={seed.isPending}>
        {seed.isPending ? "Loading demo projects…" : "Load demo projects"}
      </Button>
    </div>
  )
}

/** No runs in one project yet. Runs come from the agent, not from the
 * dashboard, so this points to the project's Integration page. */
function EmptyProjectFeed({ projectId }: { projectId: string }) {
  const { go } = useNav()
  return (
    <div className="rounded-[var(--radius-panel)] border border-dashed border-[var(--line-strong)] px-6 py-10 text-center">
      <p className="mx-auto max-w-md text-sm text-[var(--ink-2)]">
        No runs yet. Send events from your agent — see{" "}
        <button
          type="button"
          onClick={() => go("integration", { projectId })}
          className="rounded-[var(--radius-control)] font-medium text-[var(--action)] underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
        >
          Integration
        </button>
        .
      </p>
    </div>
  )
}

const GRID = "grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"

/** The most recent runs as mini sequence diagrams, the first running one live. */
export function RunFeed({ projectId, limit = 12 }: { projectId?: string; limit?: number }) {
  const { go } = useNav()
  const query = new URLSearchParams({ limit: String(limit) })
  if (projectId) query.set("projectId", projectId)
  const { data, isLoading, isError, refetch } = useQuery<{ runs: RecentRun[] }>({
    queryKey: ["runs-recent", projectId ?? "all", limit],
    queryFn: () => api(`/api/runs/recent?${query}`),
    refetchInterval: (q) => (q.state.data?.runs.some((r) => r.status === "running") ? 5000 : 30_000),
  })

  const runs = data?.runs ?? []
  const live = runs.find((r) => r.status === "running")
  const rest = live ? runs.filter((r) => r !== live) : runs
  const running = runs.filter((r) => r.status === "running").length
  const open = (r: RecentRun) => go("run", { runId: r.id, projectId: r.project.id })

  return (
    <section aria-labelledby="run-feed-title" className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="run-feed-title" className="text-base font-semibold text-[var(--ink)]">
          Recent runs
        </h2>
        {running > 0 && (
          <span className="text-[12px] text-[var(--ink-2)]">{running === 1 ? "1 running" : `${running} running`}</span>
        )}
      </div>

      {isLoading ? (
        <div className={GRID}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[146px] rounded-[var(--radius-panel)]" />
          ))}
        </div>
      ) : isError ? (
        <LoadError what="recent runs" onRetry={refetch} />
      ) : runs.length === 0 ? (
        projectId ? <EmptyProjectFeed projectId={projectId} /> : <EmptyFeed />
      ) : (
        <>
          {live && <LiveTile key={live.id} run={live} onOpen={() => open(live)} />}
          {rest.length > 0 && (
            <div className={GRID}>
              {rest.map((r) => (
                <RunTile key={r.id} run={r} onOpen={() => open(r)} />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  )
}
