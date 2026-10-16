import { runInNewContext } from "node:vm"
import { describe, expect, it } from "vitest"
import {
  parsePreference,
  readStoredPreference,
  resolveTheme,
  writeStoredPreference,
  LEGACY_THEME_STORAGE_KEY,
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
  it("falls back to the pre-rename key", () => {
    const s = memory()
    s.setItem(LEGACY_THEME_STORAGE_KEY, "phosphore")
    expect(readStoredPreference(s)).toBe("phosphore")
    s.setItem(THEME_STORAGE_KEY, "studio")
    expect(readStoredPreference(s)).toBe("studio")
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
  type Env = {
    stored?: string | null
    legacy?: string | null
    dark?: boolean
    storageThrows?: boolean
    noMatchMedia?: boolean
    written?: Map<string, string>
  }
  function boot({ stored = null, legacy = null, dark = false, storageThrows = false, noMatchMedia = false, written }: Env) {
    const attrs: Record<string, string> = {}
    const items: Record<string, string | null> = { [THEME_STORAGE_KEY]: stored, [LEGACY_THEME_STORAGE_KEY]: legacy }
    const sandbox: Record<string, unknown> = {
      window: noMatchMedia ? {} : { matchMedia: (q: string) => ({ matches: q.includes("dark") && dark }) },
      document: { documentElement: { setAttribute: (k: string, v: string) => void (attrs[k] = v) } },
    }
    Object.defineProperty(sandbox, "localStorage", {
      get() {
        if (storageThrows) throw new Error("SecurityError")
        return { getItem: (k: string) => items[k] ?? null, setItem: (k: string, v: string) => void written?.set(k, v) }
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
  it("adopts the pre-rename key and moves it to the new one", () => {
    const written = new Map<string, string>()
    expect(boot({ legacy: "phosphore", written })).toEqual({ "data-theme": "phosphore", "data-theme-pref": "phosphore" })
    expect([...written]).toEqual([[THEME_STORAGE_KEY, "phosphore"]])
  })
  it("prefers the new key over the pre-rename one, without writing", () => {
    const written = new Map<string, string>()
    expect(boot({ stored: "studio", legacy: "phosphore", dark: true, written })).toEqual({
      "data-theme": "studio",
      "data-theme-pref": "studio",
    })
    expect(written.size).toBe(0)
  })
  it("treats a missing matchMedia as a light OS", () => {
    expect(boot({ noMatchMedia: true })).toEqual({ "data-theme": "studio", "data-theme-pref": "auto" })
    expect(boot({ noMatchMedia: true, stored: "phosphore" })).toEqual({ "data-theme": "phosphore", "data-theme-pref": "phosphore" })
  })
})
