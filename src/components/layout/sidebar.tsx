"use client"

import { useNav, ViewId } from "@/lib/store"
import { cn } from "@/lib/utils"
import { useSession, useAuthActions } from "@/lib/session"
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
import { ThemeSwitcher } from "@/components/theme/theme-switcher"
import { TraceLogo } from "@/components/trace-logo"
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
  const { user, authMode } = useSession()
  const { signOut } = useAuthActions()

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
            <TraceLogo className="shrink-0 text-primary" />
            <span className="truncate text-[15px] font-semibold tracking-tight text-[var(--ink)]">LaneTrace</span>
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
      <nav className={cn("flex-1 min-h-0 overflow-y-auto overflow-x-hidden at-scroll py-4 space-y-1", collapsed ? "px-2" : "px-3")}>
        {!collapsed && (
          <div className="px-2 pb-2 text-xs font-medium text-[var(--ink-2)]">Monitor</div>
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
                  : "text-[var(--ink-2)] hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
              )}
            >
              <Icon className={cn("h-4 w-4 shrink-0", active ? "text-primary" : "text-muted-foreground group-hover:text-primary")} />
              {!collapsed && <span className="flex-1 text-left">{item.label}</span>}
              {!collapsed && active && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-primary" />}
            </button>
          )
        })}
      </nav>

      {/* Live indicator */}
      <div className={cn("border-t border-sidebar-border", collapsed ? "px-2 py-3 flex justify-center" : "px-4 py-3")}>
        {collapsed ? (
          <span className="relative flex h-2.5 w-2.5" title="Ingestion online">
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
              <span className="text-xs font-medium text-[var(--ink-2)]">Ingestion online</span>
            </div>
            <p className="mt-1.5 text-[11px] text-[var(--ink-2)] leading-snug">
              POST <span className="font-mono text-[var(--ink)]">/api/events</span> streams live
            </p>
          </div>
        )}
      </div>

      {/* Theme */}
      <div className={cn("border-t border-sidebar-border", collapsed ? "flex justify-center px-2 py-3" : "px-4 py-3")}>
        <ThemeSwitcher compact={collapsed} />
      </div>

      {/* User */}
      <div className={cn("border-t border-sidebar-border", collapsed ? "px-2 py-3" : "px-3 py-3")}>
        {collapsed ? (
          <div className="flex flex-col items-center gap-2">
            <div
              className="h-8 w-8 shrink-0 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center font-mono text-xs text-primary"
              title={user?.name || user?.email || "Account"}
            >
              {(user?.name || user?.email || "?").slice(0, 1).toUpperCase()}
            </div>
            {authMode !== "none" && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                title="Sign out"
                onClick={() => handleSignOut(signOut)}
              >
                <LogOut className="h-4 w-4" />
              </Button>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-3 px-2 py-1.5">
            <div className="h-8 w-8 shrink-0 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center font-mono text-xs text-primary">
              {(user?.name || user?.email || "?").slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{user?.name || "Engineer"}</p>
              <p className="truncate text-[11px] text-muted-foreground">{user?.email}</p>
            </div>
            {authMode !== "none" && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                title="Sign out"
                onClick={() => handleSignOut(signOut)}
              >
                <LogOut className="h-4 w-4" />
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

async function handleSignOut(signOut: () => Promise<void>) {
  try {
    await signOut()
    toast.success("Signed out")
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Sign out failed")
  }
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
      <span className="text-sm font-semibold text-[var(--ink-2)]">LaneTrace</span>
      <span className="text-muted-foreground">/</span>
      <span className="text-sm font-medium">{titles[view]}</span>
    </div>
  )
}

export { NAV }
