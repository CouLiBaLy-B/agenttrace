"use client"

import { useQuery } from "@tanstack/react-query"
import { api, formatDuration } from "@/lib/api"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

export interface DashboardStats {
  totalProjects: number
  totalRuns: number
  successRate: number
  avgMs: number
  totalEvents: number
  completed: number
  failed: number
  perProject: { id: string; runs: number; successRate: number; lastRunAt: string | null }[]
}

/** The account's totals in one bordered strip of five cells. */
export function StatStrip() {
  const { data, isLoading, isError, refetch } = useQuery<DashboardStats>({
    queryKey: ["stats"],
    queryFn: () => api("/api/stats"),
    // While a run is running its events keep coming: keep the totals current.
    refetchInterval: (q) => (q.state.data && hasRunning(q.state.data) ? 5000 : false),
  })

  const cells: { label: string; value: string }[] = [
    { label: "Projects", value: data ? String(data.totalProjects) : "—" },
    { label: "Runs", value: data ? String(data.totalRuns) : "—" },
    { label: "Success rate", value: data && data.totalRuns > 0 ? `${data.successRate}%` : "—" },
    { label: "Average duration", value: data && data.avgMs > 0 ? formatDuration(data.avgMs) : "—" },
    { label: "Events", value: data ? String(data.totalEvents) : "—" },
  ]

  return (
    <div className="space-y-2">
      {isError && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 text-[13px] text-[var(--ink-2)]">
          <span>Couldn't load the totals. Check that the AgentTrace server is running, then retry.</span>
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}
      <dl
        aria-busy={isLoading || undefined}
        className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-panel)] border border-[var(--line-strong)] bg-[var(--line)] lg:grid-cols-5"
      >
        {cells.map((c, i) => (
          <div
            key={c.label}
            className={cn("flex min-w-0 flex-col gap-1 bg-[var(--surface-1)] px-4 py-3", i === cells.length - 1 && "col-span-2 lg:col-span-1")}
          >
            <dt className="truncate font-sans text-[12px] text-[var(--ink-2)]">{c.label}</dt>
            <dd className="font-mono text-[20px] leading-7 tabular-nums text-[var(--ink)]">
              {isLoading ? <Skeleton className="h-7 w-16 rounded-[var(--radius-control)]" /> : c.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function hasRunning(s: DashboardStats) {
  return s.totalRuns - (s.completed ?? 0) - (s.failed ?? 0) > 0
}
