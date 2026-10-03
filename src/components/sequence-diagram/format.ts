const pad = (n: number) => String(n).padStart(2, "0")

/** An event's local wall-clock time, "HH:MM:SS.cc" (24 h, centiseconds). Built
 * from the date's local parts rather than a locale string so the separators
 * stay ":" and "." in every locale. Empty for an unreadable timestamp. */
export function clockTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(Math.floor(d.getMilliseconds() / 10))}`
}
