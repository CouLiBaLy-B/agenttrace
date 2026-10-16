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
      <div role="alert" className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background p-6 text-center">
        <p className="max-w-sm text-sm text-[var(--ink-2)]">
          Can&apos;t reach the LaneTrace server. Check that{" "}
          <code className="font-mono text-[var(--ink)]">lanetrace ui</code> is running, then retry.
        </p>
        <Button variant="outline" onClick={() => retry()}>
          Retry
        </Button>
      </div>
    )
  if (status === "unauthenticated") return <AuthScreen />
  return <AppShell />
}
