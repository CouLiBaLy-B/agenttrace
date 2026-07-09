import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

// Authenticate an ingestion request via project API key.
// Looks for `Authorization: Bearer atr_...` header.
export async function authenticateApiKey(req: NextRequest) {
  const authHeader = req.headers.get("authorization") || ""
  const token = authHeader.replace(/^Bearer\s+/i, "").trim()
  if (!token || !token.startsWith("atr_")) {
    return { error: NextResponse.json({ error: "Missing or invalid API key" }, { status: 401 }), project: null }
  }
  // We store a hash of the full key. Compare by hashing.
  const { hashApiKey } = await import("@/lib/keys")
  const keyHash = hashApiKey(token)
  const apiKey = await db.apiKey.findUnique({
    where: { keyHash },
    include: { project: true },
  })
  if (!apiKey) {
    return { error: NextResponse.json({ error: "Invalid API key" }, { status: 401 }), project: null }
  }
  // Update last used
  await db.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } })
  return { error: null, project: apiKey.project }
}
