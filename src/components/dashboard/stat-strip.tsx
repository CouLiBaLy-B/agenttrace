"use client"

import { useQuery } from "@tanstack/react-query"
import { api, formatDuration } from "@/lib/api"
import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"

export interface DashboardStats {
  totalProjects: number
  totalRuns: number
  successRate: number
  avgMs: number
  totalEvents: number
}

/** The account's totals in one bordered strip of five cells. */
export function StatStrip() {
  const { data, isLoading, isError } = useQuery<DashboardStats>({
    queryKey: ["stats"],
    queryFn: () => api("/api/stats"),
  })

  const cells: { label: string; value: string }[] = [
    { label: "Projects", value: data ? String(data.totalProjects) : "—" },
    { label: "Runs", value: data ? String(data.totalRuns) : "—" },
    { label: "Success rate", value: data && data.totalRuns > 0 ? `${data.successRate}%` : "—" },
    { label: "Average duration", value: data && data.avgMs > 0 ? formatDuration(data.avgMs) : "—" },
    { label: "Events", value: data ? String(data.totalEvents) : "—" },
  ]

  return (
    <dl
      aria-busy={isLoading || undefined}
      title={isError ? "Couldn't load the totals. Check that the AgentTrace server is running." : undefined}
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
  )
}
