import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"

export async function getAuthSession() {
  return getServerSession(authOptions)
}

export async function requireUser() {
  const session = await getAuthSession()
  if (!session?.user?.id) {
    return null
  }
  return session.user as { id: string; email: string; name?: string | null }
}
