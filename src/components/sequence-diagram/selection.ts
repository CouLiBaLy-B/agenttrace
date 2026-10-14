export type SelectionKey = "ArrowUp" | "ArrowDown" | "Home" | "End" | "Escape"

/** Keyboard selection over the visible events: ↑/↓ step (clamped), Home/End
 * jump, Esc clears. A selection that isn't visible (hidden by a filter)
 * restarts from the edge the key points away from. */
export function nextSelection(ids: string[], current: string | null, key: SelectionKey): string | null {
  if (key === "Escape" || ids.length === 0) return null
  if (key === "Home") return ids[0]
  if (key === "End") return ids[ids.length - 1]
  const i = current === null ? -1 : ids.indexOf(current)
  if (i === -1) return key === "ArrowDown" ? ids[0] : ids[ids.length - 1]
  return ids[Math.max(0, Math.min(ids.length - 1, key === "ArrowDown" ? i + 1 : i - 1))]
}
