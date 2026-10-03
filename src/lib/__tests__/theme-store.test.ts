import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { applyTheme, revealOrigin, useTheme } from "@/lib/theme"
import { THEME_STORAGE_KEY } from "@/lib/theme-core"

// The store drives the real <html> element; the vitest environment is plain
// Node, so give it a minimal fake document/window (no jsdom needed).
function setup({
  attrs = {},
  dark = true,
  reduce = false,
  viewTransitions = true,
  skipReveal = false,
  storage,
}: {
  attrs?: Record<string, string>
  dark?: boolean
  reduce?: boolean
  viewTransitions?: boolean
  skipReveal?: boolean
  storage?: Pick<Storage, "getItem" | "setItem">
} = {}) {
  const attributes = new Map(Object.entries(attrs))
  const styles = new Map<string, string>()
  const root = {
    getAttribute: (k: string) => attributes.get(k) ?? null,
    setAttribute: (k: string, v: string) => void attributes.set(k, v),
    removeAttribute: (k: string) => void attributes.delete(k),
    style: { setProperty: (k: string, v: string) => void styles.set(k, v) },
  }
  const transitions: Array<() => void> = []
  const startViewTransition = vi.fn((cb: () => void) => {
    transitions.push(cb)
    // like the browser: a skipped reveal (newer switch, hidden tab) rejects `ready`
    return { ready: skipReveal ? Promise.reject(new DOMException("Transition was skipped", "AbortError")) : Promise.resolve() }
  })
  const saved = new Map<string, string>()
  vi.stubGlobal("document", { documentElement: root, ...(viewTransitions ? { startViewTransition } : {}) })
  vi.stubGlobal("window", globalThis)
  vi.stubGlobal("localStorage", storage ?? { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => void saved.set(k, v) })
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduced-motion") ? reduce : dark }))
  return { attributes, styles, saved, startViewTransition, transitions }
}

beforeEach(() => {
  vi.useFakeTimers()
  useTheme.setState({ preference: "auto", resolved: "cyanotype", systemDark: true })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("applyTheme", () => {
  it("does nothing when the theme is already applied", () => {
    const env = setup({ attrs: { "data-theme": "studio" } })
    applyTheme("studio", { x: 1, y: 2 })
    expect(env.startViewTransition).not.toHaveBeenCalled()
    expect(env.styles.size).toBe(0)
    expect(env.attributes.has("data-theme-switching")).toBe(false)
  })

  it("switches instantly with reduced motion", () => {
    const env = setup({ attrs: { "data-theme": "studio" }, reduce: true })
    applyTheme("phosphore", { x: 10, y: 20 })
    expect(env.attributes.get("data-theme")).toBe("phosphore")
    expect(env.startViewTransition).not.toHaveBeenCalled()
    expect(env.attributes.has("data-theme-switching")).toBe(false)
  })

  it("reveals from the click point through a view transition", () => {
    const env = setup({ attrs: { "data-theme": "studio" } })
    applyTheme("phosphore", { x: 120, y: 340 })
    expect(env.styles.get("--vt-x")).toBe("120px")
    expect(env.styles.get("--vt-y")).toBe("340px")
    // the attribute only changes inside the transition callback
    expect(env.attributes.get("data-theme")).toBe("studio")
    env.transitions[0]()
    expect(env.attributes.get("data-theme")).toBe("phosphore")
  })

  it("reveals from the centre when there is no click point", () => {
    const env = setup({ attrs: { "data-theme": "studio" } })
    applyTheme("cyanotype")
    expect(env.styles.get("--vt-x")).toBe("50%")
    expect(env.styles.get("--vt-y")).toBe("50%")
  })

  it("swallows the rejection when the reveal is skipped", async () => {
    vi.useRealTimers()
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => void unhandled.push(reason)
    process.on("unhandledRejection", onUnhandled)
    try {
      const env = setup({ attrs: { "data-theme": "studio" }, skipReveal: true })
      applyTheme("phosphore")
      env.transitions[0]()
      await new Promise((resolve) => setTimeout(resolve, 0))
    } finally {
      process.off("unhandledRejection", onUnhandled)
    }
    expect(unhandled).toEqual([])
  })

  it("falls back to a 200 ms colour transition without view transitions", () => {
    const env = setup({ attrs: { "data-theme": "studio" }, viewTransitions: false })
    applyTheme("cyanotype")
    expect(env.attributes.get("data-theme")).toBe("cyanotype")
    expect(env.attributes.has("data-theme-switching")).toBe(true)
    vi.advanceTimersByTime(219)
    expect(env.attributes.has("data-theme-switching")).toBe(true)
    vi.advanceTimersByTime(1)
    expect(env.attributes.has("data-theme-switching")).toBe(false)
  })
})

describe("setPreference", () => {
  it("stores the choice, marks the document and applies the theme", () => {
    const env = setup({ attrs: { "data-theme": "cyanotype", "data-theme-pref": "auto" }, reduce: true })
    useTheme.getState().setPreference("studio")
    expect(env.saved.get(THEME_STORAGE_KEY)).toBe("studio")
    expect(env.attributes.get("data-theme-pref")).toBe("studio")
    expect(env.attributes.get("data-theme")).toBe("studio")
    expect(useTheme.getState()).toMatchObject({ preference: "studio", resolved: "studio" })
  })

  it("resolves auto against the OS", () => {
    const env = setup({ attrs: { "data-theme": "phosphore", "data-theme-pref": "phosphore" }, reduce: true })
    useTheme.setState({ systemDark: false })
    useTheme.getState().setPreference("auto")
    expect(env.attributes.get("data-theme")).toBe("studio")
    expect(env.attributes.get("data-theme-pref")).toBe("auto")
    expect(useTheme.getState()).toMatchObject({ preference: "auto", resolved: "studio" })
  })

  it("still applies the theme when storage is blocked", () => {
    const blocked = { getItem: () => { throw new Error("SecurityError") }, setItem: () => { throw new Error("QuotaExceeded") } }
    const env = setup({ attrs: { "data-theme": "cyanotype" }, reduce: true, storage: blocked })
    expect(() => useTheme.getState().setPreference("phosphore")).not.toThrow()
    expect(env.attributes.get("data-theme")).toBe("phosphore")
    expect(useTheme.getState().preference).toBe("phosphore")
  })
})

describe("syncFromDocument", () => {
  it("adopts what the boot script set", () => {
    setup({ attrs: { "data-theme": "phosphore", "data-theme-pref": "phosphore" }, dark: false })
    useTheme.getState().syncFromDocument()
    expect(useTheme.getState()).toMatchObject({ preference: "phosphore", resolved: "phosphore", systemDark: false })
  })

  it("resolves auto from the OS", () => {
    setup({ attrs: { "data-theme": "studio", "data-theme-pref": "auto" }, dark: false })
    useTheme.getState().syncFromDocument()
    expect(useTheme.getState()).toMatchObject({ preference: "auto", resolved: "studio", systemDark: false })
  })

  it("treats a garbage preference as auto", () => {
    setup({ attrs: { "data-theme": "cyanotype", "data-theme-pref": "neon" }, dark: true })
    useTheme.getState().syncFromDocument()
    expect(useTheme.getState()).toMatchObject({ preference: "auto", resolved: "cyanotype" })
  })

  it("applies a theme if the boot script never ran", () => {
    const env = setup({ dark: false })
    useTheme.getState().syncFromDocument()
    expect(env.attributes.get("data-theme")).toBe("studio")
  })
})

describe("setSystemDark", () => {
  it("re-themes the page while the preference is auto", () => {
    const env = setup({ attrs: { "data-theme": "cyanotype", "data-theme-pref": "auto" }, reduce: true })
    useTheme.getState().setSystemDark(false)
    expect(env.attributes.get("data-theme")).toBe("studio")
    expect(useTheme.getState()).toMatchObject({ resolved: "studio", systemDark: false })
  })

  it("leaves an explicit choice alone", () => {
    const env = setup({ attrs: { "data-theme": "phosphore", "data-theme-pref": "phosphore" }, reduce: true })
    useTheme.setState({ preference: "phosphore", resolved: "phosphore" })
    useTheme.getState().setSystemDark(false)
    expect(env.attributes.get("data-theme")).toBe("phosphore")
    expect(useTheme.getState()).toMatchObject({ resolved: "phosphore", systemDark: false })
  })
})

describe("revealOrigin", () => {
  const rect = { left: 100, top: 400, width: 28, height: 28 }
  const target = { getBoundingClientRect: () => rect }

  it("starts at the pointer for a mouse click", () => {
    expect(revealOrigin({ detail: 1, clientX: 107, clientY: 412, currentTarget: target })).toEqual({ x: 107, y: 412 })
  })

  it("starts at the centre of the control when it was activated from the keyboard", () => {
    // Enter / Space clicks report detail 0 and clientX/Y 0,0
    expect(revealOrigin({ detail: 0, clientX: 0, clientY: 0, currentTarget: target })).toEqual({ x: 114, y: 414 })
  })
})
