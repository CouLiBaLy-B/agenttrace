import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/session"
import { generateApiKey, hashApiKey, keyPrefix } from "@/lib/keys"

// GET /api/projects — list current user's projects with run stats
export async function GET() {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const projects = await db.project.findMany({
    where: { userId: user.id },
    include: {
      _count: { select: { runs: true } },
      runs: {
        orderBy: { startedAt: "desc" },
        take: 1,
        select: { id: true, name: true, status: true, startedAt: true },
      },
    },
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json({ projects })
}

// POST /api/projects — create a project (also creates a default API key)
export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const name = (body.name || "").toString().trim()
  const description = (body.description || "").toString().trim()
  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 })

  const project = await db.project.create({
    data: { name, description: description || null, userId: user.id },
  })

  const rawKey = generateApiKey()
  await db.apiKey.create({
    data: {
      projectId: project.id,
      keyHash: hashApiKey(rawKey),
      prefix: keyPrefix(rawKey),
      label: "Default key",
    },
  })

  return NextResponse.json({ project, apiKey: rawKey }, { status: 201 })
}
