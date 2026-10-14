export const VIRTUALIZE_THRESHOLD = 200
export const OVERSCAN = 20

export function visibleRange(total: number, scrollTop: number, viewportHeight: number, rowHeight: number,
  headerHeight: number, overscan = OVERSCAN): { start: number; end: number } {
  if (total <= VIRTUALIZE_THRESHOLD) return { start: 0, end: total }
  const first = Math.floor(Math.max(0, scrollTop - headerHeight) / rowHeight)
  const count = Math.ceil(viewportHeight / rowHeight) + 1
  return { start: Math.max(0, first - overscan), end: Math.min(total, first + count + overscan) }
}

/** The rows the viewport shows, [start, end) — no overscan and no threshold
 * (where the opening cascade plays). */
export function rowsInView(total: number, scrollTop: number, viewportHeight: number, rowHeight: number,
  headerHeight: number): { start: number; end: number } {
  const first = Math.floor(Math.max(0, scrollTop - headerHeight) / rowHeight)
  const count = Math.ceil(viewportHeight / rowHeight) + 1
  return { start: Math.min(total, first), end: Math.min(total, first + count) }
}
