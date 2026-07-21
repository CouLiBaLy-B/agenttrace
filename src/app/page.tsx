"use client"

import { useSession } from "@/lib/auth-client"
import { AuthScreen } from "@/components/auth/auth-screen"
import { AppShell } from "@/components/app-shell"
import { BootScreen } from "@/components/boot-screen"

export default function Home() {
  const { data: session, status } = useSession()

  if (status === "loading") return <BootScreen />
  if (!session) return <AuthScreen />
  return <AppShell />
}
