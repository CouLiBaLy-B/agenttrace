import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { authenticateApiKey } from "@/lib/api-auth"
import { emitRunEvent, emitRunUpdate } from "@/lib/socket-client"

// POST /api/events — ingestion endpoint (auth via project API key)
// Body: { runId, source, target, type, label?, payload?, durationMs?, status?, endRun? }
// Or:  { runId: null, name } to create a new run
export async function POST(req: NextRequest) {
  const { error, project } = await authenticateApiKey(req)
  if (error || !project) return error

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })

  // Create a run if runId is null/missing
  let runId = body.runId as string | undefined
  if (!runId) {
    const name = (body.name || "Untitled run").toString()
    const run = await db.run.create({
      data: { projectId: project.id, name, status: "running" },
    })
    runId = run.id
    return NextResponse.json({ runId, event: null }, { status: 201 })
  }

  // Verify the run belongs to this project
  const run = await db.run.findUnique({ where: { id: runId }, select: { id: true, projectId: true, status: true } })
  if (!run || run.projectId !== project.id) {
    return NextResponse.json({ error: "Run not found in this project" }, { status: 404 })
  }

  // Optionally close the run
  if (body.endRun) {
    const status = body.endRun === "failed" ? "failed" : "completed"
    const updated = await db.run.update({
      where: { id: runId },
      data: { status, endedAt: new Date() },
    })
    await emitRunUpdate(runId, { status: updated.status, endedAt: updated.endedAt?.toISOString() })
    return NextResponse.json({ runId, closed: true, status })
  }

  // Validate event fields
  const { source, target, type } = body
  if (!source || !target || !type) {
    return NextResponse.json({ error: "source, target, type are required" }, { status: 400 })
  }
  const validTypes = ["llm_call", "tool_call", "tool_result", "handoff", "error", "final_answer"]
  if (!validTypes.includes(type)) {
    return NextResponse.json({ error: `type must be one of: ${validTypes.join(", ")}` }, { status: 400 })
  }

  // Compute next seq
  const count = await db.event.count({ where: { runId } })

  const payload = body.payload ?? {}
  const event = await db.event.create({
    data: {
      runId,
      seq: count,
      source: String(source),
      target: String(target),
      type: String(type),
      label: body.label ? String(body.label) : null,
      payload: JSON.stringify(payload),
      durationMs: body.durationMs != null ? Number(body.durationMs) : null,
      status: body.status || (type === "error" ? "error" : "ok"),
    },
  })

  // Forward to socket service for live view
  await emitRunEvent({
    id: event.id,
    runId: event.runId,
    timestamp: event.timestamp.toISOString(),
    seq: event.seq,
    source: event.source,
    target: event.target,
    type: event.type,
    label: event.label,
    payload,
    durationMs: event.durationMs,
    status: event.status,
  })

  return NextResponse.json({ runId, event }, { status: 201 })
}
