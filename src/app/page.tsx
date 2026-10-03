"use client"

import { useSession } from "@/lib/session"
import { AuthScreen } from "@/components/auth/auth-screen"
import { AppShell } from "@/components/app-shell"
import { BootScreen } from "@/components/boot-screen"

export default function Home() {
  const { status } = useSession()
  if (status === "loading") return <BootScreen />
  if (status === "unauthenticated") return <AuthScreen />
  return <AppShell />
}
