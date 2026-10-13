import { describe, expect, it } from "vitest"
import {
  DEFAULT_RUN_SORT,
  RUN_SORT_KEYS,
  RUN_SORTS,
  describeRunSort,
  runDurationMs,
  sortRuns,
  type SortableRun,
} from "@/lib/run-sort"

const run = (id: string, over: Partial<SortableRun>): SortableRun => ({
  id,
  name: id,
  status: "completed",
  startedAt: "2026-10-01T10:00:00+00:00",
  endedAt: null,
  _count: { events: 1 },
  ...over,
})

// a: 5 s, 9 events · b: 1 s, failed · c: still running · d: 60 s, the oldest
const a = run("a", { name: "Refund #2", startedAt: "2026-10-01T10:00:00+00:00", endedAt: "2026-10-01T10:00:05+00:00", _count: { events: 9 } })
const b = run("b", { name: "refund #10", status: "failed", startedAt: "2026-10-01T11:00:00+00:00", endedAt: "2026-10-01T11:00:01+00:00", _count: { events: 3 } })
const c = run("c", { name: "Lookup", status: "running", startedAt: "2026-10-01T12:00:00Z", endedAt: null, _count: { events: 4 } })
const d = run("d", { name: "Escalate", startedAt: "2026-10-01T09:00:00+00:00", endedAt: "2026-10-01T09:01:00+00:00", _count: { events: 3 } })
const runs = [a, b, c, d]
const ids = (key: Parameters<typeof sortRuns>[1], direction: Parameters<typeof sortRuns>[2]) =>
  sortRuns(runs, key, direction).map((r) => r.id)

describe("sortRuns", () => {
  it("defaults to the newest first", () => {
    expect(DEFAULT_RUN_SORT).toEqual({ key: "date", direction: "desc" })
    expect(ids(DEFAULT_RUN_SORT.key, DEFAULT_RUN_SORT.direction)).toEqual(["c", "b", "a", "d"])
  })

  it("by date, oldest first", () => {
    expect(ids("date", "asc")).toEqual(["d", "a", "b", "c"])
  })

  it("by events, ties newest first in both directions", () => {
    expect(ids("events", "desc")).toEqual(["a", "c", "b", "d"])
    expect(ids("events", "asc")).toEqual(["b", "d", "c", "a"])
  })

  it("by duration, a running run last in both directions", () => {
    expect(ids("duration", "desc")).toEqual(["d", "a", "b", "c"])
    expect(ids("duration", "asc")).toEqual(["b", "a", "d", "c"])
  })

  it("runs without a duration keep the newest first among themselves", () => {
    const e = run("e", { status: "running", startedAt: "2026-10-01T13:00:00+00:00" })
    for (const direction of ["asc", "desc"] as const) {
      expect(sortRuns([c, a, e], "duration", direction).map((r) => r.id)).toEqual(["a", "e", "c"])
    }
  })

  it("by name, ignoring case and reading numbers as numbers", () => {
    expect(ids("name", "asc")).toEqual(["d", "c", "a", "b"])
    expect(ids("name", "desc")).toEqual(["b", "a", "c", "d"])
  })

  it("by status: completed, failed, running", () => {
    expect(ids("status", "asc")).toEqual(["a", "d", "b", "c"])
    expect(ids("status", "desc")).toEqual(["c", "b", "a", "d"])
  })

  it("a run without an event count has none", () => {
    const bare = { ...run("bare", { startedAt: "2026-10-01T08:00:00+00:00" }), _count: undefined }
    expect(sortRuns([a, bare], "events", "asc").map((r) => r.id)).toEqual(["bare", "a"])
  })

  it("returns a copy, the input keeps its order", () => {
    const input = [a, b, c, d]
    const sorted = sortRuns(input, "name", "asc")
    expect(sorted).not.toBe(input)
    expect(input.map((r) => r.id)).toEqual(["a", "b", "c", "d"])
  })
})

describe("runDurationMs", () => {
  it("is the time from start to end, or null without an end", () => {
    expect(runDurationMs(a)).toBe(5000)
    expect(runDurationMs(c)).toBeNull()
    expect(runDurationMs(run("x", { endedAt: "not a date" }))).toBeNull()
  })
})

describe("RUN_SORTS", () => {
  it("names every key and both of its directions", () => {
    expect(RUN_SORT_KEYS).toEqual(["date", "events", "duration", "name", "status"])
    for (const key of RUN_SORT_KEYS) {
      const { label, asc, desc } = RUN_SORTS[key]
      expect([label, asc, desc].every((s) => s.length > 0 && s[0] === s[0].toUpperCase())).toBe(true)
    }
  })

  it("describes the order as one sentence", () => {
    expect(describeRunSort("date", "desc")).toBe("Sorted by date, newest first")
    expect(describeRunSort("duration", "asc")).toBe("Sorted by duration, shortest first")
    expect(describeRunSort("name", "asc")).toBe("Sorted by name, A to Z")
  })
})
