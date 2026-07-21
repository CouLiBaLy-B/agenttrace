"use client"

import { useSession } from "@/lib/auth-client"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { User, Database, Sparkles, LogOut, Bell, Palette } from "lucide-react"
import { signOut } from "@/lib/auth-client"
import { Switch } from "@/components/ui/switch"

export function SettingsView() {
  const { data: session } = useSession()
  const qc = useQueryClient()

  const seedMut = useMutation({
    mutationFn: () => api("/api/seed", { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stats"] })
      qc.invalidateQueries({ queryKey: ["projects"] })
      toast.success("Demo projects reloaded")
    },
    onError: (e) => toast.error("Failed: " + (e as Error).message),
  })

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {"// configuration"}
        </p>
        <h1 className="text-2xl font-semibold mt-0.5">Settings</h1>
      </div>

      {/* Account */}
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-4">
          <User className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-medium">Account</h2>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
              Name
            </Label>
            <Input value={session?.user?.name || ""} readOnly className="bg-card" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
              Email
            </Label>
            <Input value={session?.user?.email || ""} readOnly className="bg-card" />
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-border flex items-center justify-between">
          <p className="text-xs text-muted-foreground">Sign out of AgentTrace on this device.</p>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => {
              signOut({ redirect: false }).then(() => {
                toast.success("Signed out")
                setTimeout(() => window.location.reload(), 300)
              })
            }}
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </div>
      </Card>

      {/* Demo data */}
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-4">
          <Database className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-medium">Demo data</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Reload the three sample projects (Customer Support Agent, Research Assistant, Code
          Review Bot) with fresh traces. Existing projects are left untouched.
        </p>
        <Button
          className="mt-4 gap-1.5"
          onClick={() => seedMut.mutate()}
          disabled={seedMut.isPending}
        >
          <Sparkles className="h-4 w-4" />
          {seedMut.isPending ? "Reloading…" : "Reload demo projects"}
        </Button>
      </Card>

      {/* Preferences */}
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-4">
          <Palette className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-medium">Preferences</h2>
        </div>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm">Phosphor theme</p>
              <p className="text-xs text-muted-foreground">Dark oscilloscope aesthetic — recommended.</p>
            </div>
            <Switch defaultChecked disabled />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm flex items-center gap-1.5">
                <Bell className="h-3.5 w-3.5" />
                Live event toasts
              </p>
              <p className="text-xs text-muted-foreground">Notify when a run completes or fails.</p>
            </div>
            <Switch defaultChecked />
          </div>
        </div>
      </Card>

      {/* About */}
      <Card className="p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-mono text-xs text-muted-foreground">AgentTrace</p>
            <p className="text-[11px] text-muted-foreground/70 mt-0.5">
              v1.0.0 · FastAPI · SQLAlchemy · /ws
            </p>
          </div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/60">
            trace · replay · debug
          </div>
        </div>
      </Card>
    </div>
  )
}
