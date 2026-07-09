import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/session"
import { generateApiKey, hashApiKey, keyPrefix } from "@/lib/keys"

// GET /api/keys?projectId=... — list keys for a project
export async function GET(req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const projectId = req.nextUrl.searchParams.get("projectId")
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 })

  const project = await db.project.findFirst({ where: { id: projectId, userId: user.id }, select: { id: true } })
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const keys = await db.apiKey.findMany({
    where: { projectId },
    select: { id: true, prefix: true, label: true, createdAt: true, lastUsedAt: true },
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json({ keys })
}

// POST /api/keys — regenerate/create a key. body: { projectId, label? }
export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const projectId = body.projectId
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 })

  const project = await db.project.findFirst({ where: { id: projectId, userId: user.id }, select: { id: true } })
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const rawKey = generateApiKey()
  const key = await db.apiKey.create({
    data: {
      projectId,
      keyHash: hashApiKey(rawKey),
      prefix: keyPrefix(rawKey),
      label: body.label ? String(body.label) : "Default key",
    },
  })

  return NextResponse.json({ key, rawKey }, { status: 201 })
}
