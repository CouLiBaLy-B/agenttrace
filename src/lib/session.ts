"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"

export type AuthMode = "none" | "password"

export interface SessionUser {
  id: string
  email: string
  name: string | null
}

interface SessionResponse {
  user: SessionUser | null
  authMode: AuthMode
  version: string
}

export const SESSION_KEY = ["session"] as const

export function useSession() {
  const query = useQuery({
    queryKey: SESSION_KEY,
    queryFn: () => api<SessionResponse>("/api/auth/session"),
    staleTime: 60_000,
    retry: 1,
  })
  const status: "loading" | "authenticated" | "unauthenticated" = query.isPending
    ? "loading"
    : query.data?.user
      ? "authenticated"
      : "unauthenticated"
  return {
    status,
    user: query.data?.user ?? null,
    authMode: query.data?.authMode ?? "password",
    version: query.data?.version ?? "",
  }
}

export function useAuthActions() {
  const qc = useQueryClient()
  // resetQueries refetches the session and drops every cached view of the
  // previous account, so data never leaks between sign-ins.
  const refresh = () => qc.resetQueries()
  return {
    async signIn(email: string, password: string) {
      await api("/api/auth/signin", { method: "POST", json: { email, password } })
      await refresh()
    },
    async signUp(email: string, password: string, name?: string) {
      await api("/api/auth/signup", { method: "POST", json: { email, password, name: name || undefined } })
      await refresh()
    },
    async signOut() {
      await api("/api/auth/signout", { method: "POST" })
      await refresh()
    },
  }
}
