"use client"

import { useQuery } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { api } from "@/lib/api"
import { useNav } from "@/lib/store"
import { Button } from "@/components/ui/button"
import { Chronogram } from "@/components/dashboard/chronogram"
import { RunFeed } from "@/components/dashboard/run-feed"
import { StatStrip, type DashboardStats } from "@/components/dashboard/stat-strip"

export function DashboardView() {
  const { go } = useNav()
  // Shares the strip's query. With no projects the chronogram already shows the
  // empty state (and its demo button), so the feed would only repeat it.
  const { data: stats } = useQuery<DashboardStats>({
    queryKey: ["stats"],
    queryFn: () => api("/api/stats"),
  })
  const noProjects = stats?.totalProjects === 0

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-[var(--ink)]">Dashboard</h1>
        <Button size="sm" onClick={() => go("projects", { projectId: null })} className="gap-1.5">
          <Plus className="h-4 w-4" />
          New project
        </Button>
      </div>
      <StatStrip />
      <Chronogram />
      {!noProjects && <RunFeed limit={12} />}
    </div>
  )
}
