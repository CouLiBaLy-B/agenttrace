import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/session"

type Ctx = { params: Promise<{ id: string }> }

// GET /api/projects/[id] — project detail with runs + stats
export async function GET(_req: NextRequest, { params }: Ctx) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const project = await db.project.findFirst({
    where: { id, userId: user.id },
    include: {
      runs: {
        orderBy: { startedAt: "desc" },
        include: { _count: { select: { events: true } } },
      },
      apiKeys: { select: { id: true, prefix: true, label: true, createdAt: true, lastUsedAt: true } },
    },
  })
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 })

  return NextResponse.json({ project })
}

// PATCH /api/projects/[id] — rename / update description
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const data: any = {}
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim()
  if (typeof body.description === "string") data.description = body.description.trim() || null

  const project = await db.project.updateMany({ where: { id, userId: user.id }, data })
  if (project.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const updated = await db.project.findUnique({ where: { id } })
  return NextResponse.json({ project: updated })
}

// DELETE /api/projects/[id]
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const deleted = await db.project.deleteMany({ where: { id, userId: user.id } })
  if (deleted.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })

  return NextResponse.json({ ok: true })
}
