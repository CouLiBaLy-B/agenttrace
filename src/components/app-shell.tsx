"use client"

import { useEffect, useState } from "react"
import { useNav, useLayout, NAV_SIZE } from "@/lib/store"
import { cn } from "@/lib/utils"
import { Sidebar, MobileTopBar } from "@/components/layout/sidebar"
import { ResizeHandle } from "@/components/layout/resize-handle"
import { Sheet, SheetContent } from "@/components/ui/sheet"
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

  // Persisted layout is rehydrated after mount to avoid SSR hydration mismatch.
  useEffect(() => {
    useLayout.persist.rehydrate()
  }, [])

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <div className="flex flex-1 min-h-0">
        {/* Desktop sidebar — retractable (icon rail) + resizable */}
        <aside
          className={cn(
            "relative hidden lg:flex shrink-0 border-r border-sidebar-border",
            dragging ? "" : "transition-[width] duration-200 ease-out"
          )}
          style={{ width: navCollapsed ? NAV_SIZE.rail : navWidth }}
        >
          <Sidebar collapsed={navCollapsed} onToggle={toggleNav} />
          {!navCollapsed && (
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
