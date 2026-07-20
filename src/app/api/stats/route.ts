import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/session"
import { extractTokens } from "@/lib/tokens"

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

  // Event-type distribution (for the radar-ish sparkline) — counted in the DB.
  const typeGroups = await db.event.groupBy({
    by: ["type"],
    where: { run: { projectId: { in: projectIds } } },
    _count: { _all: true },
  })
  const typeDist: Record<string, number> = {}
  for (const g of typeGroups) typeDist[g.type] = g._count._all

  // Token aggregation — only llm_call events carry usage payloads, so fetch
  // just those instead of every event's payload.
  const llmEvents = await db.event.findMany({
    where: { run: { projectId: { in: projectIds } }, type: "llm_call" },
    select: { payload: true },
  })
  let totalTokens = 0
  let promptTokens = 0
  let completionTokens = 0
  for (const e of llmEvents) {
    const t = extractTokens(safeParse(e.payload))
    if (t) {
      totalTokens += t.total_tokens
      promptTokens += t.prompt_tokens
      completionTokens += t.completion_tokens
    }
  }

  return NextResponse.json({
    totalProjects: projects.length,
    totalRuns,
    completed,
    failed,
    successRate,
    avgMs,
    totalEvents,
    totalTokens,
    promptTokens,
    completionTokens,
    perProject,
    recent,
    typeDist,
  })
}

// Parse a stored event payload (JSON string) into an object for extractTokens.
function safeParse(payload: string): unknown {
  try {
    return typeof payload === "string" ? JSON.parse(payload) : payload
  } catch {
    return null
  }
}
