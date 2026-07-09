import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/session"

type Ctx = { params: Promise<{ id: string }> }

// GET /api/runs/[id]/events — list events for a run (ordered by seq)
export async function GET(_req: NextRequest, { params }: Ctx) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const run = await db.run.findUnique({
    where: { id },
    include: { project: { select: { userId: true } } },
  })
  if (!run || run.project.userId !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const events = await db.event.findMany({
    where: { runId: id },
    orderBy: { seq: "asc" },
  })

  return NextResponse.json({ events })
}
