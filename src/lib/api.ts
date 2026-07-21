// Client-side fetch helpers

// Empty by default: the static bundle is served by the same FastAPI process
// as /api/*, so relative paths just work. Set NEXT_PUBLIC_API_BASE (build-time)
// to point at a separately-running backend while iterating on the UI with
// `bun run dev` (see next.config.ts).
const API_BASE = process.env.NEXT_PUBLIC_API_BASE || ""

export async function api<T = any>(
  path: string,
  opts?: RequestInit & { json?: any }
): Promise<T> {
  const { json, ...rest } = opts || {}
  const headers: Record<string, string> = { ...(rest.headers as any) }
  let body = rest.body
  if (json !== undefined) {
    headers["Content-Type"] = "application/json"
    body = JSON.stringify(json)
  }
  const res = await fetch(`${API_BASE}${path}`, { ...rest, headers, body, credentials: "same-origin" })
  const text = await res.text()
  const data = text ? safeJson(text) : null
  if (!res.ok) {
    const msg = (data && data.error) || res.statusText || "Request failed"
    throw new Error(msg)
  }
  return data as T
}

function safeJson(s: string) {
  try {
    return JSON.parse(s)
  } catch {
    return s
  }
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "—"
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60000)
  const s = Math.round((ms % 60000) / 1000)
  return `${m}m ${s}s`
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso).getTime()
  const now = Date.now()
  const diff = Math.max(0, now - d)
  const min = Math.floor(diff / 60000)
  if (min < 1) return "just now"
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d ago`
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}
