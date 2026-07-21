"use client"

// Drop-in replacement for next-auth/react's useSession/signIn/signOut/SessionProvider,
// talking to the FastAPI backend's signed-cookie session (/api/auth/*) instead of
// NextAuth's server runtime (which has no static-export equivalent). Same call
// shapes as next-auth/react on purpose, so call sites only need an import swap.

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react"
import { api } from "@/lib/api"

type SessionUser = { id: string; email: string; name?: string | null }
type Session = { user: SessionUser } | null
type Status = "loading" | "authenticated" | "unauthenticated"

const SessionContext = createContext<{ data: Session; status: Status }>({
  data: null,
  status: "loading",
})

export function SessionProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Session>(null)
  const [status, setStatus] = useState<Status>("loading")

  const refresh = useCallback(async () => {
    try {
      const res = await api<{ user: SessionUser | null }>("/api/auth/session")
      setData(res.user ? { user: res.user } : null)
      setStatus(res.user ? "authenticated" : "unauthenticated")
    } catch {
      setData(null)
      setStatus("unauthenticated")
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return <SessionContext.Provider value={{ data, status }}>{children}</SessionContext.Provider>
}

export function useSession() {
  return useContext(SessionContext)
}

export async function signIn(
  _provider: "credentials",
  opts: {
    email: string
    password: string
    name?: string
    mode: "signin" | "signup"
    redirect?: boolean
  }
): Promise<{ error?: string }> {
  try {
    const path = opts.mode === "signup" ? "/api/auth/signup" : "/api/auth/signin"
    await api(path, { method: "POST", json: { email: opts.email, password: opts.password, name: opts.name } })
    return {}
  } catch (e) {
    return { error: (e as Error).message }
  }
}

export async function signOut(_opts?: { redirect?: boolean }): Promise<void> {
  await api("/api/auth/signout", { method: "POST" })
}
