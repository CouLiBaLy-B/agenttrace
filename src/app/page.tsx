"use client"

import { useSession } from "@/lib/session"
import { AuthScreen } from "@/components/auth/auth-screen"
import { AppShell } from "@/components/app-shell"
import { Button } from "@/components/ui/button"
import { BootScreen, useBootPlaying } from "@/components/boot-screen"

export default function Home() {
  const { status, retry } = useSession()
  // A boot sequence that started plays to its end, even when the session is already known.
  const booting = useBootPlaying()
  if (status === "loading" || booting) return <BootScreen />
  if (status === "error")
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 at-graticule">
        <p className="font-mono text-xs tracking-[0.2em] text-muted-foreground uppercase">
          Can&apos;t reach the AgentTrace server
        </p>
        <Button variant="outline" onClick={() => retry()}>
          Retry
        </Button>
      </div>
    )
  if (status === "unauthenticated") return <AuthScreen />
  return <AppShell />
}
