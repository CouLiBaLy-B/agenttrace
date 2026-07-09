import { NextResponse } from "next/server"
import { requireUser } from "@/lib/session"
import { seedDemoData } from "@/lib/seed"

// POST /api/seed — re-seed demo data for the current user (idempotent)
export async function POST() {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  await seedDemoData(user.id)
  return NextResponse.json({ ok: true })
}
