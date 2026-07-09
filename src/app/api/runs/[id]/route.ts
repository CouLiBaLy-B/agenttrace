import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/session"
import { emitRunEvent } from "@/lib/socket-client"

type Ctx = { params: Promise<{ id: string }> }

// GET /api/runs/[id] — full run with events
export async function GET(_req: NextRequest, { params }: Ctx) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const run = await db.run.findFirst({
    where: { id },
    include: {
      project: { select: { id: true, name: true, userId: true } },
      events: { orderBy: { seq: "asc" } },
    },
  })
  if (!run || run.project.userId !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  return NextResponse.json({ run })
}

// PATCH /api/runs/[id] — rename or update status
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))

  const existing = await db.run.findUnique({ where: { id }, include: { project: { select: { userId: true } } } })
  if (!existing || existing.project.userId !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const data: any = {}
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim()
  if (body.status === "completed" || body.status === "failed" || body.status === "running") {
    data.status = body.status
    if (body.status !== "running") data.endedAt = new Date()
    else data.endedAt = null
  }

  const run = await db.run.update({ where: { id }, data })
  return NextResponse.json({ run })
}

// DELETE /api/runs/[id]
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const existing = await db.run.findUnique({ where: { id }, include: { project: { select: { userId: true } } } })
  if (!existing || existing.project.userId !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  await db.run.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}

// We re-export emitRunEvent usage to keep imports used (no-op otherwise)
export const _noop = emitRunEvent
