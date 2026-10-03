import { afterEach, describe, expect, it, vi } from "vitest"

// The layout store persists to localStorage, which can be missing or throw
// (blocked storage, some private modes). It must keep working in memory then.
afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage
  vi.restoreAllMocks()
  vi.resetModules()
})

async function loadStore() {
  vi.resetModules()
  return (await import("@/lib/store")).useLayout
}

describe("layout store", () => {
  it("keeps working, quietly, when localStorage throws", async () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("The operation is insecure.", "SecurityError")
      },
    })
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const useLayout = await loadStore()
    expect(useLayout.persist).toBeDefined()
    await useLayout.persist.rehydrate()
    useLayout.getState().toggleNav()
    useLayout.getState().setNavWidth(300)
    expect(useLayout.getState()).toMatchObject({ navCollapsed: true, navWidth: 300 })
    expect(warn).not.toHaveBeenCalled()
  })

  it("still persists to localStorage when it is available", async () => {
    const saved = new Map<string, string>()
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => saved.get(k) ?? null,
        setItem: (k: string, v: string) => void saved.set(k, v),
        removeItem: (k: string) => void saved.delete(k),
      },
    })
    const useLayout = await loadStore()
    useLayout.getState().toggleNav()
    expect(JSON.parse(saved.get("agenttrace-layout")!).state).toMatchObject({ navCollapsed: true })
  })
})
