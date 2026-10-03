"use client"

import { useLayoutEffect, useRef, useState, type RefObject } from "react"

/** Within this distance of the end, a reader counts as following. */
export const FOLLOW_SLACK_PX = 200

/** Keeps a scroll container at its end while `follow` is on and the reader is
 * there: new rows scroll into view, but not once they have scrolled away.
 * Whether the reader is at the end is measured on scroll, before new rows land,
 * so a batch taller than the slack doesn't stop following. If `follow` is on
 * when it mounts, the container opens at its end (before the first paint);
 * declare it before any layout effect that reads the opening scroll position. */
export function useFollowEnd(ref: RefObject<HTMLElement | null>, follow: boolean, size: number) {
  const atEnd = useRef(true)
  const [openAtEnd] = useState(follow)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (openAtEnd) el.scrollTop = el.scrollHeight
    const measure = () => {
      atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_SLACK_PX
    }
    measure()
    el.addEventListener("scroll", measure, { passive: true })
    return () => el.removeEventListener("scroll", measure)
  }, [ref, openAtEnd])

  useLayoutEffect(() => {
    const el = ref.current
    if (el && follow && atEnd.current) el.scrollTop = el.scrollHeight
  }, [ref, follow, size])
}
