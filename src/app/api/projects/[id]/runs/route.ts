import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/session"

type Ctx = { params: Promise<{ id: string }> }

// GET /api/projects/[id]/runs — list runs for a project
export async function GET(_req: NextRequest, { params }: Ctx) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const project = await db.project.findFirst({ where: { id, userId: user.id }, select: { id: true } })
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const runs = await db.run.findMany({
    where: { projectId: id },
    orderBy: { startedAt: "desc" },
    include: { _count: { select: { events: true } } },
  })

  return NextResponse.json({ runs })
}

// POST /api/projects/[id]/runs — create a run manually from UI
export async function POST(req: NextRequest, { params }: Ctx) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const project = await db.project.findFirst({ where: { id, userId: user.id }, select: { id: true } })
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const name = (body.name || "Untitled run").toString().trim()

  const run = await db.run.create({
    data: { projectId: id, name, status: "running" },
  })

  return NextResponse.json({ run }, { status: 201 })
}
