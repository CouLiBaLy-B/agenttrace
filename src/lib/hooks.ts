"use client"

import { useCallback, useSyncExternalStore } from "react"

/** Whether a media query matches. Read during the first client render, so a
 * view never renders the other layout for a frame first (the run view used to
 * build the mobile timeline of every event before switching to the diagram);
 * false while prerendering. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query)
      mql.addEventListener("change", onChange)
      return () => mql.removeEventListener("change", onChange)
    },
    [query],
  )
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false)
}
