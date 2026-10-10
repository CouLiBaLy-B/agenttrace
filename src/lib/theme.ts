"use client"

import { create } from "zustand"
import {
  parsePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  writeStoredPreference,
  type ThemeId,
  type ThemePreference,
} from "./theme-core"

export * from "./theme-core"

function safeStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

// The theme most recently asked for. With View Transitions the attribute only
// changes inside the deferred update callback, so it can lag behind a request.
// Comparing against this, and having every commit write it, keeps the page and
// the store in step when switches overlap (Studio, then straight back to
// Cyanotype) and drops repeats of a theme that is already on its way.
let requested: ThemeId | null = null

export function applyTheme(next: ThemeId, origin?: { x: number; y: number }): void {
  const root = document.documentElement
  if ((requested ?? root.getAttribute("data-theme")) === next) return
  requested = next
  const commit = () => root.setAttribute("data-theme", requested ?? next)
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
  const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready?: Promise<unknown> } }
  if (reduce) return commit()
  if (doc.startViewTransition) {
    root.style.setProperty("--vt-x", origin ? `${origin.x}px` : "50%")
    root.style.setProperty("--vt-y", origin ? `${origin.y}px` : "50%")
    // A newer switch (or a hidden tab) skips this reveal and rejects `ready`;
    // the theme still changes, so that is not an error worth reporting.
    doc.startViewTransition(commit).ready?.catch(() => {})
    return
  }
  root.setAttribute("data-theme-switching", "")
  commit()
  window.setTimeout(() => root.removeAttribute("data-theme-switching"), 220)
}

/** Where the reveal starts: the pointer, or the centre of the control when it
 * was activated from the keyboard (those clicks report clientX/Y = 0,0). */
export function revealOrigin(e: {
  detail: number
  clientX: number
  clientY: number
  currentTarget: { getBoundingClientRect(): { left: number; top: number; width: number; height: number } }
}): { x: number; y: number } {
  if (e.detail === 0) {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }
  return { x: e.clientX, y: e.clientY }
}

interface ThemeState {
  preference: ThemePreference
  resolved: ThemeId
  systemDark: boolean
  setPreference: (pref: ThemePreference, origin?: { x: number; y: number }) => void
  syncFromDocument: () => void
  adoptStoredPreference: (raw: string | null) => void
  setSystemDark: (dark: boolean) => void
}

// The initial state is what the server prerenders; ThemeSync replaces it with
// the real values (from the attributes the boot script set) after hydration.
export const useTheme = create<ThemeState>((set, get) => ({
  preference: "auto",
  resolved: "cyanotype",
  systemDark: true,
  setPreference: (preference, origin) => {
    const resolved = resolveTheme(preference, get().systemDark)
    writeStoredPreference(safeStorage(), preference)
    document.documentElement.setAttribute("data-theme-pref", preference)
    applyTheme(resolved, origin)
    set({ preference, resolved })
  },
  syncFromDocument: () => {
    const root = document.documentElement
    const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches
    const preference = parsePreference(root.getAttribute("data-theme-pref"))
    const resolved = resolveTheme(preference, systemDark)
    // The boot script normally set the theme before first paint. If it was
    // blocked (every token would be undefined), or the OS changed between it
    // and now, bring the page in line with the store. No reveal while hydrating.
    if (root.getAttribute("data-theme") !== resolved) root.setAttribute("data-theme", resolved)
    requested = null // the document is the source of truth again
    set({ preference, systemDark, resolved })
  },
  adoptStoredPreference: (raw) => {
    // Another tab already stored this preference and played its reveal: follow
    // it instantly here (no transition, no storage write back).
    const preference = parsePreference(raw)
    const resolved = resolveTheme(preference, get().systemDark)
    const root = document.documentElement
    root.setAttribute("data-theme-pref", preference)
    requested = resolved // a reveal still pending in this tab commits this theme, not its own
    root.setAttribute("data-theme", resolved)
    set({ preference, resolved })
  },
  setSystemDark: (systemDark) => {
    const { preference } = get()
    const resolved = resolveTheme(preference, systemDark)
    set({ systemDark, resolved })
    if (preference === "auto") applyTheme(resolved)
  },
}))

/** `storage` event handler: keeps every open tab on the theme chosen in any of
 * them. `key` is null when another tab cleared its storage (back to auto). */
export function themeStorageListener(e: Pick<StorageEvent, "key" | "newValue">): void {
  if (e.key !== THEME_STORAGE_KEY && e.key !== null) return
  useTheme.getState().adoptStoredPreference(e.key === null ? null : e.newValue)
}
