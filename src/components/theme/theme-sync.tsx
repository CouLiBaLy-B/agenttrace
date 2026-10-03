"use client"

import { useEffect } from "react"
import { useTheme } from "@/lib/theme"

/** Hydrates the theme store from the attributes the boot script set, and
 * follows OS light/dark changes while the preference is "auto". */
export function ThemeSync() {
  useEffect(() => {
    useTheme.getState().syncFromDocument()
    const mql = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => useTheme.getState().setSystemDark(mql.matches)
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [])
  return null
}
