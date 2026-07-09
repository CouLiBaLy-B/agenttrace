"use client"

import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"

export type ViewId =
  | "dashboard"
  | "projects"
  | "project"
  | "run"
  | "integration"
  | "settings"

interface NavState {
  view: ViewId
  projectId: string | null
  runId: string | null
  sidebarOpen: boolean
  go: (view: ViewId, opts?: { projectId?: string | null; runId?: string | null }) => void
  setSidebarOpen: (open: boolean) => void
}

export const useNav = create<NavState>((set) => ({
  view: "dashboard",
  projectId: null,
  runId: null,
  sidebarOpen: false,
  go: (view, opts) =>
    set((state) => ({
      view,
      projectId: opts && "projectId" in opts ? opts.projectId! : state.projectId,
      runId: opts && "runId" in opts ? opts.runId! : state.runId,
      sidebarOpen: false,
    })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
}))

// ─── Layout: retractable + resizable side panels ───────────────────────────
// Width bounds (px). `rail` is the collapsed icon-rail width.
export const NAV_SIZE = { default: 256, min: 208, max: 400, rail: 60 }
export const DETAIL_SIZE = { default: 320, min: 264, max: 560, rail: 44 }

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

interface LayoutState {
  navCollapsed: boolean
  navWidth: number
  detailCollapsed: boolean
  detailWidth: number
  toggleNav: () => void
  setNavWidth: (w: number) => void
  toggleDetail: () => void
  setDetailWidth: (w: number) => void
}

export const useLayout = create<LayoutState>()(
  persist(
    (set) => ({
      navCollapsed: false,
      navWidth: NAV_SIZE.default,
      detailCollapsed: false,
      detailWidth: DETAIL_SIZE.default,
      toggleNav: () => set((s) => ({ navCollapsed: !s.navCollapsed })),
      setNavWidth: (w) => set({ navWidth: clamp(w, NAV_SIZE.min, NAV_SIZE.max) }),
      toggleDetail: () => set((s) => ({ detailCollapsed: !s.detailCollapsed })),
      setDetailWidth: (w) => set({ detailWidth: clamp(w, DETAIL_SIZE.min, DETAIL_SIZE.max) }),
    }),
    {
      name: "agenttrace-layout",
      storage: createJSONStorage(() => localStorage),
      // Avoid SSR/first-render hydration mismatch: start from defaults, then
      // rehydrate from localStorage after mount (see AppShell).
      skipHydration: true,
    }
  )
)
