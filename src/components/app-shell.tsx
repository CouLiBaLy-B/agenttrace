"use client"

import { useEffect, useState } from "react"
import { useNav, useLayout, NAV_SIZE } from "@/lib/store"
import { cn } from "@/lib/utils"
import { Sidebar, MobileTopBar } from "@/components/layout/sidebar"
import { ResizeHandle } from "@/components/layout/resize-handle"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { DashboardView } from "@/components/views/dashboard-view"
import { ProjectsView } from "@/components/views/projects-view"
import { ProjectDetailView } from "@/components/views/project-detail-view"
import { RunView } from "@/components/views/run-view"
import { IntegrationView } from "@/components/views/integration-view"
import { SettingsView } from "@/components/views/settings-view"
import { Menu } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Footer } from "@/components/layout/footer"

export function AppShell() {
  const { view, sidebarOpen, setSidebarOpen } = useNav()
  const { navCollapsed, navWidth, toggleNav, setNavWidth } = useLayout()
  const [dragging, setDragging] = useState(false)

  // Run focus: the run view collapses the sidebar to its rail, leaving the
  // diagram room. Expanding it there lasts until the reader leaves the view;
  // the saved preference (navCollapsed) is left alone unless they expand a
  // sidebar they had collapsed everywhere.
  const runFocus = view === "run"
  const [runNavExpanded, setRunNavExpanded] = useState(false)
  const [wasRunFocus, setWasRunFocus] = useState(runFocus)
  if (wasRunFocus !== runFocus) {
    setWasRunFocus(runFocus)
    if (!runFocus) setRunNavExpanded(false)
  }
  const collapsed = navCollapsed || (runFocus && !runNavExpanded)
  const toggleSidebar = () => {
    if (!runFocus) return toggleNav()
    if (!collapsed) return setRunNavExpanded(false)
    setRunNavExpanded(true)
    if (navCollapsed) toggleNav()
  }

  // Persisted layout is rehydrated after mount to avoid SSR hydration mismatch.
  useEffect(() => {
    useLayout.persist.rehydrate()
  }, [])

  return (
    // Bounded to the viewport: <main> scrolls inside it, so the sidebar (with
    // the theme switcher and account) and the footer never leave the screen.
    <div className="h-screen supports-[height:100dvh]:h-dvh overflow-hidden flex flex-col bg-background">
      <div className="flex flex-1 min-h-0">
        {/* Desktop sidebar — retractable (icon rail) + resizable */}
        <aside
          className={cn(
            "relative hidden lg:flex shrink-0 border-r border-sidebar-border",
            dragging ? "" : "transition-[width] duration-200 ease-out motion-reduce:transition-none"
          )}
          style={{ width: collapsed ? NAV_SIZE.rail : navWidth }}
        >
          <Sidebar collapsed={collapsed} onToggle={toggleSidebar} />
          {!collapsed && (
            <ResizeHandle
              width={navWidth}
              setWidth={setNavWidth}
              edge="right"
              onDragStart={() => setDragging(true)}
              onDragEnd={() => setDragging(false)}
            />
          )}
        </aside>

        {/* Mobile sidebar drawer */}
        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetContent side="left" className="w-72 p-0">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SheetDescription className="sr-only">Go to a page, or change the theme.</SheetDescription>
            <Sidebar onNavigate={() => setSidebarOpen(false)} />
          </SheetContent>
        </Sheet>

        {/* Main */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Mobile menu button */}
          <div className="lg:hidden flex items-center gap-3 px-4 h-14 border-b border-border">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              aria-label="Open navigation"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>
            <MobileTopBar />
          </div>

          <main className="flex-1 min-h-0 overflow-y-auto at-scroll">
            {view === "dashboard" && <DashboardView />}
            {view === "projects" && <ProjectsView />}
            {view === "project" && <ProjectDetailView />}
            {view === "run" && <RunView />}
            {view === "integration" && <IntegrationView />}
            {view === "settings" && <SettingsView />}
          </main>
        </div>
      </div>

      <Footer />
    </div>
  )
}
