"use client"

import { useCallback, useLayoutEffect, useState, useSyncExternalStore } from "react"

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

/** A callback ref and the width of the element it is attached to, kept
 * current as it resizes (0 until measured). A callback ref, so it re-attaches
 * when the element remounts. */
export function useElementWidth<T extends HTMLElement = HTMLElement>() {
  const [el, setEl] = useState<T | null>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    if (!el) return
    // ResizeObserver reports the initial size on observe.
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return [setEl, width] as const
}
