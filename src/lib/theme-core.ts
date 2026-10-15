// Pure theme logic. No "use client" and no React/zustand, so the server layout
// can import THEME_BOOT_SCRIPT from here. The client store is in ./theme.

export type ThemeId = "phosphore" | "cyanotype" | "studio"
export type ThemePreference = ThemeId | "auto"
export const THEME_IDS: ThemeId[] = ["phosphore", "cyanotype", "studio"]
export const THEME_LABELS: Record<ThemeId, string> = { phosphore: "Phosphore", cyanotype: "Cyanotype", studio: "Studio" }
export const THEME_STORAGE_KEY = "lanetrace-theme"
/** Where AgentTrace (before the LaneTrace rename) stored the preference: read
 * when THEME_STORAGE_KEY is missing, and copied to it by the boot script. */
export const LEGACY_THEME_STORAGE_KEY = "agenttrace-theme"

type ReadStorage = Pick<Storage, "getItem"> | null | undefined
type WriteStorage = Pick<Storage, "setItem"> | null | undefined

export function resolveTheme(pref: ThemePreference, prefersDark: boolean): ThemeId {
  if (pref === "auto") return prefersDark ? "cyanotype" : "studio"
  return pref
}

export function parsePreference(raw: unknown): ThemePreference {
  return raw === "auto" || THEME_IDS.includes(raw as ThemeId) ? (raw as ThemePreference) : "auto"
}

export function readStoredPreference(storage: ReadStorage): ThemePreference {
  try {
    return parsePreference(storage?.getItem(THEME_STORAGE_KEY) ?? storage?.getItem(LEGACY_THEME_STORAGE_KEY))
  } catch {
    return "auto"
  }
}

export function writeStoredPreference(storage: WriteStorage, pref: ThemePreference): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, pref)
  } catch {
    // private mode / blocked storage: the choice lasts for this session only
  }
}

/** Runs in <head> before first paint (keep in sync with resolveTheme and
 * readStoredPreference); moves a legacy stored preference to the new key. */
export const THEME_BOOT_SCRIPT = `(function(){var p=null;try{var s=localStorage,k=${JSON.stringify(
  THEME_STORAGE_KEY,
)};p=s.getItem(k);if(p===null){p=s.getItem(${JSON.stringify(
  LEGACY_THEME_STORAGE_KEY,
)});if(p!==null)s.setItem(k,p)}}catch(e){}var ids=${JSON.stringify(THEME_IDS)};var dark=!!(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches);var pref=ids.indexOf(p)>=0?p:"auto";var t=pref==="auto"?(dark?"cyanotype":"studio"):pref;var r=document.documentElement;r.setAttribute("data-theme",t);r.setAttribute("data-theme-pref",pref)})()`
