"use client"

import { useNav, ViewId } from "@/lib/store"
import { cn } from "@/lib/utils"
import { signOut, useSession } from "@/lib/auth-client"
import {
  LayoutDashboard,
  FolderGit2,
  Cable,
  Settings,
  LogOut,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"

const NAV: { id: ViewId; label: string; icon: any; hint: string }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, hint: "overview" },
  { id: "projects", label: "Projects", icon: FolderGit2, hint: "traces" },
  { id: "integration", label: "Integration", icon: Cable, hint: "api keys" },
  { id: "settings", label: "Settings", icon: Settings, hint: "account" },
]

export function Sidebar({
  onNavigate,
  collapsed = false,
  onToggle,
}: {
  onNavigate?: () => void
  collapsed?: boolean
  onToggle?: () => void
}) {
  const { view, go } = useNav()
  const { data: session } = useSession()

  return (
    <div className="flex h-full w-full min-w-0 flex-col bg-sidebar text-sidebar-foreground">
      {/* Brand + collapse toggle */}
      <div
        className={cn(
          "flex items-center h-16 border-b border-sidebar-border",
          collapsed ? "justify-center px-0" : "gap-2 px-5"
        )}
      >
        {collapsed ? (
          onToggle && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              onClick={onToggle}
              title="Expand sidebar"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </Button>
          )
        ) : (
          <>
            <svg width="22" height="22" viewBox="0 0 24 24" className="shrink-0 text-primary">
              <rect x="2" y="2" width="20" height="20" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
              <path
                d="M2 12 L7 12 L9 7 L11 17 L13 9 L15 15 L17 12 L22 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="at-glow"
              />
            </svg>
            <span className="truncate font-mono text-sm tracking-[0.25em] text-primary/90 at-glow uppercase">
              AgentTrace
            </span>
            {onToggle && (
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={onToggle}
                title="Collapse sidebar"
              >
                <PanelLeftClose className="h-4 w-4" />
              </Button>
            )}
          </>
        )}
      </div>

      {/* Nav */}
      <nav className={cn("flex-1 py-4 space-y-1", collapsed ? "px-2" : "px-3")}>
        {!collapsed && (
          <div className="px-2 pb-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground/60">
            monitor
          </div>
        )}
        {NAV.map((item) => {
          const active = view === item.id || (item.id === "projects" && (view === "project" || view === "run"))
          const Icon = item.icon
          return (
            <button
              key={item.id}
              onClick={() => {
                go(item.id)
                onNavigate?.()
              }}
              title={collapsed ? item.label : undefined}
              className={cn(
                "group w-full flex items-center rounded-md text-sm transition-colors",
                collapsed ? "justify-center h-10" : "gap-3 px-3 py-2",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
              )}
            >
              <Icon className={cn("h-4 w-4 shrink-0", active ? "text-primary" : "text-muted-foreground group-hover:text-primary")} />
              {!collapsed && <span className="flex-1 text-left">{item.label}</span>}
              {!collapsed && active && <span className="h-1.5 w-1.5 rounded-full bg-primary at-dot text-primary" />}
            </button>
          )
        })}
      </nav>

      {/* Live indicator */}
      <div className={cn("border-t border-sidebar-border", collapsed ? "px-2 py-3 flex justify-center" : "px-4 py-3")}>
        {collapsed ? (
          <span className="relative flex h-2.5 w-2.5" title="ingestion online">
            <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-60 at-pulse-ring" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
          </span>
        ) : (
          <div className="rounded-md border border-sidebar-border bg-sidebar-accent/40 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-60 at-pulse-ring" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
              </span>
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                ingestion online
              </span>
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground/70 leading-snug">
              POST <span className="text-primary/80 font-mono">/api/events</span> streams live
            </p>
          </div>
        )}
      </div>

      {/* User */}
      <div className={cn("border-t border-sidebar-border", collapsed ? "px-2 py-3" : "px-3 py-3")}>
        {collapsed ? (
          <div className="flex flex-col items-center gap-2">
            <div
              className="h-8 w-8 shrink-0 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center font-mono text-xs text-primary"
              title={session?.user?.name || session?.user?.email || "Account"}
            >
              {(session?.user?.name || session?.user?.email || "?").slice(0, 1).toUpperCase()}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              title="Sign out"
              onClick={() => handleSignOut()}
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-3 px-2 py-1.5">
            <div className="h-8 w-8 shrink-0 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center font-mono text-xs text-primary">
              {(session?.user?.name || session?.user?.email || "?").slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{session?.user?.name || "Engineer"}</p>
              <p className="truncate text-[11px] text-muted-foreground">{session?.user?.email}</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              title="Sign out"
              onClick={() => handleSignOut()}
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

function handleSignOut() {
  signOut({ redirect: false }).then(() => {
    toast.success("Signed out")
    setTimeout(() => window.location.reload(), 300)
  })
}

export function MobileTopBar() {
  const { view } = useNav()
  const titles: Record<ViewId, string> = {
    dashboard: "Dashboard",
    projects: "Projects",
    project: "Project",
    run: "Run trace",
    integration: "Integration",
    settings: "Settings",
  }
  return (
    <div className="lg:hidden flex items-center gap-2 px-4 h-14 border-b border-border bg-background/80 backdrop-blur">
      <ChevronRight className="h-4 w-4 text-muted-foreground" />
      <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">AgentTrace</span>
      <span className="text-muted-foreground">/</span>
      <span className="text-sm font-medium">{titles[view]}</span>
    </div>
  )
}

export { NAV }
