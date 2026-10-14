/** Sorting a project's "All runs" list. */

export type RunSortKey = "date" | "events" | "duration" | "name" | "status"
export type SortDirection = "asc" | "desc"

/** What the list sorts on: a run row of GET /api/projects/{id}. */
export interface SortableRun {
  id: string
  name: string
  status: string
  startedAt: string
  endedAt: string | null
  _count?: { events: number }
}

/** Each sort's name and how each direction reads, for the controls. */
export const RUN_SORTS: Record<RunSortKey, { label: string; asc: string; desc: string }> = {
  date: { label: "Date", asc: "Oldest first", desc: "Newest first" },
  events: { label: "Events", asc: "Fewest first", desc: "Most first" },
  duration: { label: "Duration", asc: "Shortest first", desc: "Longest first" },
  name: { label: "Name", asc: "A to Z", desc: "Z to A" },
  // Statuses in alphabetical order: completed, failed, running.
  status: { label: "Status", asc: "Completed first", desc: "Running first" },
}

export const RUN_SORT_KEYS = Object.keys(RUN_SORTS) as RunSortKey[]

export const DEFAULT_RUN_SORT: { key: RunSortKey; direction: SortDirection } = { key: "date", direction: "desc" }

/** The order as a sentence, "Sorted by date, newest first" ("A to Z" keeps its capitals). */
export function describeRunSort(key: RunSortKey, direction: SortDirection): string {
  const order = RUN_SORTS[key][direction].replace(/^[A-Z](?=[a-z])/, (c) => c.toLowerCase())
  return `Sorted by ${RUN_SORTS[key].label.toLowerCase()}, ${order}`
}

const time = (iso: string | null | undefined): number | null => {
  const t = iso ? Date.parse(iso) : NaN
  return Number.isNaN(t) ? null : t
}

/** A finished run's duration in ms; null while it runs (no end yet) or when a time can't be read. */
export function runDurationMs(run: SortableRun): number | null {
  const start = time(run.startedAt)
  const end = time(run.endedAt)
  return start === null || end === null ? null : Math.max(0, end - start)
}

const events = (run: SortableRun) => run._count?.events ?? 0
const started = (run: SortableRun) => time(run.startedAt) ?? 0
// Case-insensitive, and "run 2" before "run 10".
const names = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" })

/** Ascending order of each key; durations only compare when both runs have one. */
const ASCENDING: Record<RunSortKey, (a: SortableRun, b: SortableRun) => number> = {
  date: (a, b) => started(a) - started(b),
  events: (a, b) => events(a) - events(b),
  duration: (a, b) => (runDurationMs(a) ?? 0) - (runDurationMs(b) ?? 0),
  name: (a, b) => names.compare(a.name, b.name),
  status: (a, b) => a.status.localeCompare(b.status),
}

/** Equal runs: newest first, whichever the direction, then by id so the order is stable. */
const tieBreak = (a: SortableRun, b: SortableRun) => started(b) - started(a) || a.id.localeCompare(b.id)

/** A comparator for `key` in `direction`. Sorting by duration puts the runs
 * without one (still running) last in both directions. */
export function compareRuns(key: RunSortKey, direction: SortDirection): (a: SortableRun, b: SortableRun) => number {
  const sign = direction === "asc" ? 1 : -1
  return (a, b) => {
    if (key === "duration") {
      const missing = Number(runDurationMs(a) === null) - Number(runDurationMs(b) === null)
      if (missing !== 0) return missing
    }
    return sign * ASCENDING[key](a, b) || tieBreak(a, b)
  }
}

/** A sorted copy of `runs`. */
export function sortRuns<T extends SortableRun>(runs: readonly T[], key: RunSortKey, direction: SortDirection): T[] {
  return [...runs].sort(compareRuns(key, direction))
}
