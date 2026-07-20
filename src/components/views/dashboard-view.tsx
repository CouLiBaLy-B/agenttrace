"use client"

import { useQuery } from "@tanstack/react-query"
import { api, formatDuration, formatRelative } from "@/lib/api"
import { useNav } from "@/lib/store"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  FolderGit2,
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  Zap,
  ArrowRight,
  Plus,
  Radio,
  Coins,
} from "lucide-react"
import { EVENT_COLORS } from "@/lib/types"
import { motion } from "framer-motion"
import { formatTokens } from "@/lib/tokens"

interface Stats {
  totalProjects: number
  totalRuns: number
  completed: number
  failed: number
  successRate: number
  avgMs: number
  totalEvents: number
  totalTokens: number
  promptTokens: number
  completionTokens: number
  perProject: {
    id: string
    name: string
    description: string | null
    runs: number
    successRate: number
    lastRunAt: string | null
  }[]
  recent: {
    id: string
    name: string
    status: string
    startedAt: string
    endedAt: string | null
    durationMs: number | null
    events: number
    project: { id: string; name: string }
  }[]
  typeDist: Record<string, number>
}

export function DashboardView() {
  const { go } = useNav()
  const { data, isLoading } = useQuery<Stats>({
    queryKey: ["stats"],
    queryFn: () => api("/api/stats"),
  })

  if (isLoading) return <DashboardSkeleton />
  if (!data) return null

  const empty = data.totalProjects === 0

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      {/* header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {"// telemetry overview"}
          </p>
          <h1 className="text-2xl font-semibold mt-0.5">Dashboard</h1>
        </div>
        <Button size="sm" onClick={() => go("projects", { projectId: null })} className="gap-1.5">
          <Plus className="h-4 w-4" />
          New project
        </Button>
      </div>

      {empty ? (
        <EmptyDashboard onCreate={() => go("projects")} />
      ) : (
        <>
          {/* stat grid */}
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            <StatCard icon={FolderGit2} label="Projects" value={String(data.totalProjects)} tint="#34d399" />
            <StatCard icon={Activity} label="Total runs" value={String(data.totalRuns)} tint="#22d3ee" />
            <StatCard
              icon={data.successRate >= 80 ? CheckCircle2 : XCircle}
              label="Success rate"
              value={`${data.successRate}%`}
              tint={data.successRate >= 80 ? "#34d399" : "#f87171"}
            />
            <StatCard icon={Clock} label="Avg duration" value={formatDuration(data.avgMs)} tint="#fbbf24" />
            <StatCard icon={Zap} label="Events captured" value={String(data.totalEvents)} tint="#a78bfa" />
            <StatCard icon={Coins} label="Tokens used" value={formatTokens(data.totalTokens || 0)} tint="#22d3ee" />
          </div>

          {/* token breakdown (only if there are tokens) */}
          {(data.totalTokens || 0) > 0 && (
            <Card className="p-5 at-graticule-fine">
              <div className="flex items-center gap-2 mb-3">
                <Coins className="h-4 w-4 text-cyan-400" />
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  token consumption
                </p>
                <span className="ml-auto font-mono text-sm font-semibold tabular-nums">
                  {formatTokens(data.totalTokens)} total
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <TokenStat
                  label="prompt"
                  value={data.promptTokens}
                  total={data.totalTokens}
                  color="#22d3ee"
                />
                <TokenStat
                  label="completion"
                  value={data.completionTokens}
                  total={data.totalTokens}
                  color="#a78bfa"
                />
              </div>
            </Card>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* signal distribution (radar-ish) */}
            <Card className="lg:col-span-1 p-5 at-graticule-fine relative overflow-hidden">
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                event signal mix
              </p>
              <SignalMix typeDist={data.typeDist} />
            </Card>

            {/* recent runs */}
            <Card className="lg:col-span-2 p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  recent activity
                </p>
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => go("projects")}>
                  All runs <ArrowRight className="ml-1 h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="space-y-1.5 max-h-[340px] overflow-y-auto at-scroll pr-1">
                {data.recent.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">No runs yet.</p>
                ) : (
                  data.recent.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => go("run", { runId: r.id })}
                      className="group w-full flex items-center gap-3 rounded-md border border-transparent hover:border-border hover:bg-accent/40 px-2.5 py-2 text-left transition-colors"
                    >
                      <StatusDot status={r.status} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm truncate">{r.name}</p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {r.project.name} · {r.events} events · {formatRelative(r.startedAt)}
                        </p>
                      </div>
                      <span className="font-mono text-[11px] text-muted-foreground shrink-0">
                        {formatDuration(r.durationMs)}
                      </span>
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                    </button>
                  ))
                )}
              </div>
            </Card>
          </div>

          {/* per-project */}
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-3">
              projects
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {data.perProject.map((p) => (
                <Card
                  key={p.id}
                  className="p-4 hover:border-primary/40 cursor-pointer transition-colors group"
                  onClick={() => go("project", { projectId: p.id })}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{p.name}</p>
                      <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                        {p.description || "No description"}
                      </p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                  </div>
                  <div className="mt-3 flex items-center gap-4 text-xs">
                    <span className="font-mono text-muted-foreground">
                      {p.runs} <span className="text-muted-foreground/60">runs</span>
                    </span>
                    <span className="font-mono" style={{ color: p.successRate >= 80 ? "#34d399" : "#fbbf24" }}>
                      {p.successRate}%
                    </span>
                    <span className="font-mono text-muted-foreground ml-auto">
                      {formatRelative(p.lastRunAt)}
                    </span>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function StatCard({
  icon: Icon,
  label,
  value,
  tint,
}: {
  icon: any
  label: string
  value: string
  tint: string
}) {
  return (
    <Card className="p-4 relative overflow-hidden">
      <div
        className="absolute -top-6 -right-6 h-20 w-20 rounded-full opacity-10"
        style={{ background: tint }}
      />
      <Icon className="h-4 w-4" style={{ color: tint }} />
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mt-0.5">
        {label}
      </p>
    </Card>
  )
}

function TokenStat({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? (value / total) * 100 : 0
  return (
    <div className="rounded-md border border-border bg-background/40 p-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
        <span className="font-mono text-sm font-semibold tabular-nums" style={{ color }}>
          {formatTokens(value)}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-border/60 overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ background: color, boxShadow: `0 0 6px ${color}88` }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        />
      </div>
      <p className="mt-1 font-mono text-[9px] text-muted-foreground/70">{pct.toFixed(0)}% of total</p>
    </div>
  )
}

function SignalMix({ typeDist }: { typeDist: Record<string, number> }) {
  const types = Object.keys(EVENT_COLORS) as (keyof typeof EVENT_COLORS)[]
  const total = types.reduce((acc, t) => acc + (typeDist[t] || 0), 0) || 1
  return (
    <div className="mt-4 space-y-2.5">
      {types.map((t) => {
        const count = typeDist[t] || 0
        const pct = (count / total) * 100
        const meta = EVENT_COLORS[t]
        return (
          <div key={t}>
            <div className="flex items-center justify-between text-[11px] font-mono mb-1">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: meta.color, boxShadow: `0 0 5px ${meta.color}` }} />
                <span className="text-muted-foreground">{meta.label}</span>
              </span>
              <span className="text-foreground/80 tabular-nums">{count}</span>
            </div>
            <div className="h-1.5 rounded-full bg-border/60 overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{ background: meta.color, boxShadow: `0 0 6px ${meta.color}88` }}
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.6, ease: "easeOut" }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === "completed" ? "#34d399" : status === "failed" ? "#f87171" : "#fbbf24"
  return (
    <span
      className="relative flex h-2.5 w-2.5 shrink-0"
      title={status}
    >
      {status === "running" && (
        <span className="absolute inline-flex h-full w-full rounded-full opacity-60 at-pulse-ring" style={{ background: color }} />
      )}
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
    </span>
  )
}

function DashboardSkeleton() {
  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-8 w-28" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Skeleton className="h-64" />
        <Skeleton className="h-64 lg:col-span-2" />
      </div>
    </div>
  )
}

function EmptyDashboard({ onCreate }: { onCreate: () => void }) {
  return (
    <Card className="p-10 at-graticule at-scanlines relative overflow-hidden text-center">
      <div className="relative z-10 max-w-md mx-auto">
        <div className="relative h-24 w-24 mx-auto rounded-full border border-primary/30 flex items-center justify-center">
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
          <Radio className="h-6 w-6 text-primary at-glow" />
        </div>
        <h3 className="mt-6 text-lg font-medium">No projects yet</h3>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Create your first project to start streaming agent traces — or load a demo to explore
          the sequence diagram with realistic data.
        </p>
        <div className="mt-5 flex items-center justify-center gap-2">
          <Button onClick={onCreate} className="gap-1.5">
            <Plus className="h-4 w-4" />
            Create your first project
          </Button>
        </div>
      </div>
    </Card>
  )
}


