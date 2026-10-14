"use client"

import { useEffect } from "react"
import { themeStorageListener, useTheme } from "@/lib/theme"

/** Hydrates the theme store from the attributes the boot script set, follows
 * OS light/dark changes while the preference is "auto", and follows theme
 * changes made in other tabs. */
export function ThemeSync() {
  useEffect(() => {
    useTheme.getState().syncFromDocument()
    const mql = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => useTheme.getState().setSystemDark(mql.matches)
    mql.addEventListener("change", onChange)
    window.addEventListener("storage", themeStorageListener)
    return () => {
      mql.removeEventListener("change", onChange)
      window.removeEventListener("storage", themeStorageListener)
    }
  }, [])
  return null
}
