"use client"

import { cn } from "@/lib/utils"

interface Props {
  /** current width in px */
  width: number
  /** commit a new width (store clamps to min/max) */
  setWidth: (w: number) => void
  /**
   * Which edge the handle sits on:
   *  - "right": handle on the right edge of a left-docked panel (drag right → wider)
   *  - "left":  handle on the left edge of a right-docked panel (drag left → wider)
   */
  edge: "left" | "right"
  onDragStart?: () => void
  onDragEnd?: () => void
  className?: string
}

/**
 * Thin vertical splitter. Pointer-driven, no dependencies. Widens/narrows the
 * adjacent panel by tracking horizontal pointer movement from the drag origin.
 */
export function ResizeHandle({ width, setWidth, edge, onDragStart, onDragEnd, className }: Props) {
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // ignore non-primary buttons
    if (e.button !== 0) return
    e.preventDefault()
    const startX = e.clientX
    const startW = width
    onDragStart?.()
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX
      setWidth(edge === "right" ? startW + dx : startW - dx)
    }
    const onUp = () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      onDragEnd?.()
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 32 : 8
    if (e.key === "ArrowLeft") { e.preventDefault(); setWidth(width + (edge === "right" ? -step : step)) }
    if (e.key === "ArrowRight") { e.preventDefault(); setWidth(width + (edge === "right" ? step : -step)) }
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className={cn(
        "group absolute inset-y-0 z-20 w-1.5 cursor-col-resize touch-none",
        "hover:bg-primary/30 focus-visible:bg-primary/40 focus-visible:outline-none transition-colors",
        edge === "right" ? "-right-0.5" : "-left-0.5",
        className
      )}
    >
      {/* wider invisible hit area for easier grabbing */}
      <span className="absolute inset-y-0 -inset-x-1" />
    </div>
  )
}
