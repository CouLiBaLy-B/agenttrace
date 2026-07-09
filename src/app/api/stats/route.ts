import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/session"

// GET /api/stats — dashboard home stats for the current user
export async function GET() {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const projects = await db.project.findMany({
    where: { userId: user.id },
    select: { id: true, name: true, description: true, createdAt: true },
  })

  const projectIds = projects.map((p) => p.id)

  const runs = await db.run.findMany({
    where: { projectId: { in: projectIds } },
    include: {
      project: { select: { id: true, name: true } },
      _count: { select: { events: true } },
    },
    orderBy: { startedAt: "desc" },
  })

  const totalRuns = runs.length
  const completed = runs.filter((r) => r.status === "completed").length
  const failed = runs.filter((r) => r.status === "failed").length
  const successRate = totalRuns > 0 ? Math.round((completed / totalRuns) * 100) : 0

  const finishedRuns = runs.filter((r) => r.endedAt)
  const avgMs =
    finishedRuns.length > 0
      ? Math.round(
          finishedRuns.reduce((acc, r) => {
            const dur = r.endedAt!.getTime() - r.startedAt.getTime()
            return acc + dur
          }, 0) / finishedRuns.length
        )
      : 0

  const totalEvents = runs.reduce((acc, r) => acc + r._count.events, 0)

  // Per-project breakdown
  const perProject = projects.map((p) => {
    const pr = runs.filter((r) => r.projectId === p.id)
    const pc = pr.filter((r) => r.status === "completed").length
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      runs: pr.length,
      successRate: pr.length > 0 ? Math.round((pc / pr.length) * 100) : 0,
      lastRunAt: pr[0]?.startedAt.toISOString() ?? null,
    }
  })

  // Recent runs (last 8) for the activity feed
  const recent = runs.slice(0, 8).map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    startedAt: r.startedAt.toISOString(),
    endedAt: r.endedAt?.toISOString() ?? null,
    durationMs: r.endedAt ? r.endedAt.getTime() - r.startedAt.getTime() : null,
    events: r._count.events,
    project: r.project,
  }))

  // Event-type distribution (for the radar-ish sparkline)
  const allEvents = await db.event.findMany({
    where: { run: { projectId: { in: projectIds } } },
    select: { type: true },
  })
  const typeDist: Record<string, number> = {}
  for (const e of allEvents) typeDist[e.type] = (typeDist[e.type] || 0) + 1

  return NextResponse.json({
    totalProjects: projects.length,
    totalRuns,
    completed,
    failed,
    successRate,
    avgMs,
    totalEvents,
    perProject,
    recent,
    typeDist,
  })
}
