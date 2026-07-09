import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/session"

type Ctx = { params: Promise<{ id: string }> }

// DELETE /api/keys/[id]?projectId=... — delete a key
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const projectId = req.nextUrl.searchParams.get("projectId")
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 })

  const project = await db.project.findFirst({ where: { id: projectId, userId: user.id }, select: { id: true } })
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 })

  await db.apiKey.deleteMany({ where: { id, projectId } })
  return NextResponse.json({ ok: true })
}
