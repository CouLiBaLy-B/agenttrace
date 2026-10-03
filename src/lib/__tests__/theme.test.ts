import { runInNewContext } from "node:vm"
import { describe, expect, it } from "vitest"
import {
  parsePreference,
  readStoredPreference,
  resolveTheme,
  writeStoredPreference,
  THEME_BOOT_SCRIPT,
  THEME_STORAGE_KEY,
} from "@/lib/theme-core"

describe("resolveTheme", () => {
  it("auto follows the OS", () => {
    expect(resolveTheme("auto", true)).toBe("cyanotype")
    expect(resolveTheme("auto", false)).toBe("studio")
  })
  it("explicit choice wins", () => {
    expect(resolveTheme("phosphore", false)).toBe("phosphore")
    expect(resolveTheme("studio", true)).toBe("studio")
  })
})

describe("stored preference", () => {
  const memory = () => {
    const m = new Map<string, string>()
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
  }
  const throwing = {
    getItem: () => { throw new Error("SecurityError") },
    setItem: () => { throw new Error("QuotaExceeded") },
  }
  it("round-trips a valid preference", () => {
    const s = memory()
    writeStoredPreference(s, "phosphore")
    expect(readStoredPreference(s)).toBe("phosphore")
  })
  it("ignores garbage", () => {
    const s = memory()
    s.setItem(THEME_STORAGE_KEY, "neon")
    expect(readStoredPreference(s)).toBe("auto")
    expect(parsePreference(null)).toBe("auto")
  })
  it("survives storage that throws", () => {
    expect(readStoredPreference(throwing)).toBe("auto")
    expect(() => writeStoredPreference(throwing, "studio")).not.toThrow()
    expect(readStoredPreference(null)).toBe("auto")
  })
})

// The boot script is a hand-minified copy of resolveTheme/parsePreference that
// runs in <head> before React; run it against stubbed browser globals so the
// two cannot drift apart.
describe("THEME_BOOT_SCRIPT", () => {
  type Env = { stored?: string | null; dark?: boolean; storageThrows?: boolean; noMatchMedia?: boolean }
  function boot({ stored = null, dark = false, storageThrows = false, noMatchMedia = false }: Env) {
    const attrs: Record<string, string> = {}
    const sandbox: Record<string, unknown> = {
      window: noMatchMedia ? {} : { matchMedia: (q: string) => ({ matches: q.includes("dark") && dark }) },
      document: { documentElement: { setAttribute: (k: string, v: string) => void (attrs[k] = v) } },
    }
    Object.defineProperty(sandbox, "localStorage", {
      get() {
        if (storageThrows) throw new Error("SecurityError")
        return { getItem: (k: string) => (k === THEME_STORAGE_KEY ? stored : null) }
      },
    })
    runInNewContext(THEME_BOOT_SCRIPT, sandbox)
    return attrs
  }

  const stored = [null, "auto", "phosphore", "cyanotype", "studio", "neon", ""]
  it.each(stored.flatMap((s) => [true, false].map((dark) => [s, dark] as const)))(
    "stored %j, OS dark %s matches resolveTheme",
    (s, dark) => {
      const pref = parsePreference(s)
      expect(boot({ stored: s, dark })).toEqual({ "data-theme": resolveTheme(pref, dark), "data-theme-pref": pref })
    },
  )
  it("falls back to auto when storage throws", () => {
    expect(boot({ storageThrows: true, dark: true })).toEqual({ "data-theme": "cyanotype", "data-theme-pref": "auto" })
    expect(boot({ storageThrows: true, dark: false })).toEqual({ "data-theme": "studio", "data-theme-pref": "auto" })
  })
  it("treats a missing matchMedia as a light OS", () => {
    expect(boot({ noMatchMedia: true })).toEqual({ "data-theme": "studio", "data-theme-pref": "auto" })
    expect(boot({ noMatchMedia: true, stored: "phosphore" })).toEqual({ "data-theme": "phosphore", "data-theme-pref": "phosphore" })
  })
})
