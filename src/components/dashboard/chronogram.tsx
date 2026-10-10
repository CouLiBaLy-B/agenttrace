"use client"

import { LoadError } from "@/components/load-error"
import { useEffect, useState, type CSSProperties, type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import { api, formatDuration } from "@/lib/api"
import { DIAGRAM_STYLES } from "@/lib/diagram-styles"
import { useElementWidth } from "@/lib/hooks"
import { useNav } from "@/lib/store"
import { useTheme } from "@/lib/theme"
import { RUN_STATUS, type RunStatus } from "@/lib/types"
import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"
import { chronoLayout, chronoTicks } from "./chrono-scale"
import { EmptyFeed } from "./run-feed"

const H = 3_600_000
const ROW_H = 28
const SEG_H = 14
const TICK_EVERY = 3 // px between density ticks, at most one per event
const NOW_EVERY = 10_000

interface TimelineRun {
  id: string
  name: string
  status: RunStatus
  startedAt: string
  endedAt: string | null
  eventCount: number
}

interface Timeline {
  from: string
  to: string
  truncated: boolean
  projects: { id: string; name: string; runs: TimelineRun[] }[]
}


/** "now", re-read every 10 s so running runs grow and the window slides. */
function useNow() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), NOW_EVERY)
    return () => window.clearInterval(id)
  }, [])
  return now
}

function runDuration(r: TimelineRun, now: number): string {
  const start = new Date(r.startedAt).getTime()
  const end = r.endedAt ? new Date(r.endedAt).getTime() : r.status === "running" ? now : NaN
  return Number.isFinite(end) && end >= start ? formatDuration(end - start) : "no end time"
}

function title(hours: number) {
  if (hours === 1) return "Last hour"
  return hours > 24 && hours % 24 === 0 ? `Last ${hours / 24} days` : `Last ${hours} hours`
}

/** Five labels need ~60 px each, so a phone-width track gets three. A week
 * gets one tick per day when eight labels fit, otherwise just its two ends. */
function tickCount(hours: number, width: number) {
  const measured = width > 0
  if (hours === 168) return measured && width < 420 ? 1 : 7
  return measured && width < 300 ? 2 : 4
}

/** A run as a segment on its project's row: fill and border in its status
 * colour, one hairline tick per ~3 px (at most one per event) for density. */
function Segment({
  run,
  x,
  w,
  startedBefore,
  live,
  now,
  onOpen,
}: {
  run: TimelineRun
  x: number
  w: number
  startedBefore: boolean
  live: boolean
  now: number
  onOpen: () => void
}) {
  const meta = RUN_STATUS[run.status] ?? RUN_STATUS.completed
  const duration = runDuration(run, now)
  const ticks = Math.min(run.eventCount, Math.floor(w / TICK_EVERY))
  const step = ticks > 0 ? w / ticks : 0
  const style: CSSProperties = {
    left: x,
    width: w,
    top: (ROW_H - SEG_H) / 2,
    height: SEG_H,
    borderColor: meta.color,
    borderLeftStyle: startedBefore ? "dashed" : "solid",
    backgroundColor: `color-mix(in oklab, ${meta.color} 22%, transparent)`,
    ...(ticks > 0 && {
      backgroundImage: `linear-gradient(to right, color-mix(in oklab, ${meta.color} 60%, transparent) 0 1px, transparent 1px)`,
      backgroundSize: `${step}px 60%`,
      backgroundPosition: `${step / 2 - 1}px center`,
      backgroundRepeat: "repeat-x",
    }),
  }
  const started = new Date(run.startedAt).toLocaleString()
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${run.name}, ${meta.label.toLowerCase()}, ${duration}`}
      title={`${run.name}\n${meta.label} · ${duration} · ${run.eventCount === 1 ? "1 event" : `${run.eventCount} events`}\nStarted ${started}`}
      className={cn(
        "absolute rounded-[2px] border hover:z-10 focus-visible:z-10",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
        live && "at-chrono-live z-[5]",
      )}
      style={style}
    />
  )
}

/** Runs of the last `hours` hours, one row per project, placed in time. */
export function Chronogram({
  projectId,
  hours = 24,
  controls,
}: {
  projectId?: string
  hours?: number
  /** Shown at the end of the header, e.g. a window toggle. */
  controls?: ReactNode
}) {
  const { go } = useNav()
  const lifeline = DIAGRAM_STYLES[useTheme((s) => s.resolved)].lifeline
  const now = useNow()
  const [track, width] = useElementWidth<HTMLDivElement>()

  const query = new URLSearchParams({ hours: String(hours) })
  if (projectId) query.set("projectId", projectId)
  const { data, isLoading, isError, refetch, dataUpdatedAt } = useQuery<Timeline>({
    queryKey: ["timeline", projectId ?? "all", hours],
    queryFn: () => api(`/api/timeline?${query}`),
    refetchInterval: (q) =>
      q.state.data?.projects.some((p) => p.runs.some((r) => r.status === "running")) ? 5000 : 30_000,
  })

  // A refetch can land between two ticks of the clock: never draw "now" before the data.
  const to = Math.max(now, dataUpdatedAt)
  const from = to - hours * H
  const ticks = chronoTicks(from, to, tickCount(hours, width))
  const projects = data?.projects ?? []
  const runs = projects.flatMap((p) => p.runs)
  const running = runs.filter((r) => r.status === "running").length

  const header = (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h2 id="chronogram-title" className="text-base font-semibold text-[var(--ink)]">
        {title(hours)}
      </h2>
      {data && runs.length > 0 && (
        <span className="text-[12px] text-[var(--ink-2)]">
          {runs.length === 1 ? "1 run" : `${runs.length} runs`}
          {running > 0 && `, ${running} running`}
          {data.truncated && " · Showing the latest 500 runs"}
        </span>
      )}
      {controls && <div className="ml-auto">{controls}</div>}
    </div>
  )

  if (!isLoading && !isError && projects.length === 0) {
    return (
      <section aria-labelledby="chronogram-title" className="space-y-3">
        {header}
        <EmptyFeed />
      </section>
    )
  }

  return (
    <section
      aria-labelledby="chronogram-title"
      className="space-y-3 rounded-[var(--radius-panel)] border border-[var(--line)] bg-[var(--surface-1)] p-4"
    >
      {header}
      {isError ? (
        <LoadError what="the timeline" onRetry={refetch} framed={false} />
      ) : (
        <div className="flex">
          {/* project names (one project's own page already names it) */}
          {!projectId && (
            <ul className="w-24 shrink-0 pr-3 sm:w-40" aria-label="Projects">
              {(isLoading ? [] : projects).map((p) => (
                <li key={p.id} className="flex items-center" style={{ height: ROW_H }}>
                  <button
                    type="button"
                    onClick={() => go("project", { projectId: p.id })}
                    title={p.name}
                    className="max-w-full truncate rounded-[var(--radius-control)] text-left text-[13px] text-[var(--ink)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                  >
                    {p.name}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* the time track */}
          <div className="min-w-0 flex-1">
            <div ref={track} className="relative" style={{ minHeight: isLoading ? 3 * ROW_H : undefined }}>
              {width > 0 && (
                <div aria-hidden="true" className="pointer-events-none absolute inset-0">
                  {ticks.slice(0, -1).map((t, i) => (
                    <span key={i} className="absolute inset-y-0 w-px bg-[var(--line)]" style={{ left: t.x * width }} />
                  ))}
                  {/* now */}
                  <span
                    className="absolute inset-y-0 border-l border-dashed border-[var(--st-running)]"
                    style={{ left: width - 1 }}
                  />
                </div>
              )}

              {isLoading
                ? Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="flex items-center" style={{ height: ROW_H }}>
                      <Skeleton className="h-3.5 w-full rounded-[2px]" />
                    </div>
                  ))
                : width > 0 &&
                  projects.map((p) => {
                    const layout = chronoLayout(p.runs, from, to, width)
                    return (
                      <div key={p.id} className="relative" style={{ height: ROW_H }}>
                        <svg aria-hidden="true" className="absolute inset-x-0 top-1/2 block overflow-visible" width={width} height={1}>
                          <line
                            x1={0}
                            x2={width}
                            y1={0}
                            y2={0}
                            stroke="var(--line-strong)"
                            strokeWidth={lifeline.width}
                            strokeDasharray={lifeline.dash || undefined}
                          />
                        </svg>
                        {p.runs.map((r, i) => {
                          const { x, w, startedBefore, live, placeable } = layout[i]
                          if (!placeable) return null
                          return (
                            <Segment
                              key={r.id}
                              run={r}
                              x={Math.max(0, Math.min(x, width - w))}
                              w={Math.min(w, width)}
                              startedBefore={startedBefore}
                              live={live}
                              now={to}
                              onOpen={() => go("run", { runId: r.id, projectId: p.id })}
                            />
                          )
                        })}
                      </div>
                    )
                  })}
            </div>

            {/* tick labels */}
            {width > 0 && (
              <div aria-hidden="true" className="relative mt-1.5 h-4 font-mono text-[11px] text-[var(--ink-2)]">
                {ticks.map((t, i) => (
                  <span
                    key={i}
                    className={cn("absolute top-0 whitespace-nowrap tabular-nums", i === ticks.length - 1 && "font-medium")}
                    style={{
                      left: t.x * width,
                      transform: i === 0 ? undefined : i === ticks.length - 1 ? "translateX(-100%)" : "translateX(-50%)",
                    }}
                  >
                    {t.label}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {data && runs.length === 0 && projects.length > 0 && (
        <p className="text-[13px] text-[var(--ink-2)]">No runs in this window.</p>
      )}
    </section>
  )
}
