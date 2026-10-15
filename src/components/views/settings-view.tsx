"use client"

import { useSession, useAuthActions } from "@/lib/session"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ThemePicker } from "@/components/settings/theme-picker"
import { toast } from "sonner"
import { User, Database, Sparkles, LogOut, Palette } from "lucide-react"

function SectionTitle({ id, icon: Icon, children }: { id?: string; icon: typeof User; children: string }) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <Icon className="h-4 w-4 text-[var(--ink-2)]" />
      <h2 id={id} className="text-sm font-semibold text-[var(--ink)]">
        {children}
      </h2>
    </div>
  )
}

export function SettingsView() {
  const { user, authMode, version } = useSession()
  const { signOut } = useAuthActions()
  const qc = useQueryClient()

  const seedMut = useMutation({
    mutationFn: () => api<{ seeded: number }>("/api/seed", { method: "POST" }),
    onSuccess: ({ seeded }) => {
      qc.invalidateQueries({ queryKey: ["stats"] })
      qc.invalidateQueries({ queryKey: ["projects"] })
      qc.invalidateQueries({ queryKey: ["timeline"] })
      qc.invalidateQueries({ queryKey: ["runs-recent"] })
      toast.success(
        seeded
          ? `Loaded ${seeded} demo projects`
          : "Demo projects already present (only added when you have no projects)",
      )
    },
    onError: (e) => toast.error(`Couldn't load the demo projects: ${(e as Error).message}`),
  })

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-semibold text-[var(--ink)]">Settings</h1>

      {/* Appearance */}
      <Card className="p-5 gap-0">
        <SectionTitle id="settings-theme" icon={Palette}>
          Theme
        </SectionTitle>
        <ThemePicker labelledBy="settings-theme" />
      </Card>

      {/* Account */}
      <Card className="p-5 gap-0">
        <SectionTitle icon={User}>Account</SectionTitle>
        {authMode === "none" ? (
          <p className="text-sm text-[var(--ink-2)]">
            Local mode: no account (started with <code className="font-mono text-[var(--ink)]">lanetrace ui --auth none</code>).
          </p>
        ) : (
          <>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="settings-name" className="text-xs text-[var(--ink-2)]">
                  Name
                </Label>
                <Input id="settings-name" value={user?.name || ""} readOnly className="bg-card" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="settings-email" className="text-xs text-[var(--ink-2)]">
                  Email
                </Label>
                <Input id="settings-email" value={user?.email || ""} readOnly className="bg-card" />
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-[var(--line)] flex items-center justify-between gap-3">
              <p className="text-xs text-[var(--ink-2)]">Sign out of LaneTrace on this device.</p>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={async () => {
                  try {
                    await signOut()
                    toast.success("Signed out")
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Sign out failed")
                  }
                }}
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </Button>
            </div>
          </>
        )}
      </Card>

      {/* Demo data */}
      <Card className="p-5 gap-0">
        <SectionTitle icon={Database}>Demo data</SectionTitle>
        <p className="text-sm text-[var(--ink-2)]">
          Load the three sample projects (Customer Support Agent, Research Assistant, Code Review Bot) with their
          traces. They are only added when you have no projects yet.
        </p>
        <Button className="mt-4 gap-1.5 self-start" onClick={() => seedMut.mutate()} disabled={seedMut.isPending}>
          <Sparkles className="h-4 w-4" />
          {seedMut.isPending ? "Loading…" : "Load demo projects"}
        </Button>
      </Card>

      {/* About */}
      <Card className="p-5 gap-0">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-semibold text-[var(--ink)]">LaneTrace</p>
          <p className="at-clock text-xs text-[var(--ink-2)]">{`v${version}`}</p>
        </div>
        <p className="mt-1 text-xs text-[var(--ink-2)]">Trace, replay and debug your agents.</p>
      </Card>
    </div>
  )
}
