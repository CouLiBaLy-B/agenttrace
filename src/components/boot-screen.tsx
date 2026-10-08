"use client"

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react"
import { motion } from "framer-motion"
import { TraceLogo } from "@/components/trace-logo"
import { parsePreference, type ThemeId } from "@/lib/theme-core"

/** The boot sequences fit in this, and the app waits for the end of one. */
export const BOOT_MS = 1200
const EASE_OUT = [0.2, 0.7, 0.2, 1] as const

// Once per page load: which sequence plays (null until the first boot screen
// mounts), and whether it is still playing. The page keeps the boot screen up
// until it ends, even when the session resolved earlier, so the screen
// underneath never flashes through.
type BootMode = ThemeId | "still"
let bootMode: BootMode | null = null
let playing = false
const listeners = new Set<() => void>()
function emit() {
  listeners.forEach((l) => l())
}
function subscribe(l: () => void) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

function startBoot() {
  if (bootMode !== null) return
  const theme = parsePreference(document.documentElement.getAttribute("data-theme"))
  if (theme === "auto" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    bootMode = "still"
  } else {
    bootMode = theme
    playing = true
    window.setTimeout(() => {
      playing = false
      emit()
    }, BOOT_MS)
  }
  emit()
}

/** True while the boot sequence plays: show the boot screen until it ends. */
export function useBootPlaying(): boolean {
  return useSyncExternalStore(subscribe, () => playing, () => false)
}

/** Shown while the session loads. The first time in a page load it plays the
 * active theme's power-on sequence (≤ 1.2 s); afterwards, and with reduced
 * motion, a still logo. Decided after mount: the prerendered page can't know
 * the theme or the motion preference. */
export function BootScreen() {
  const mode = useSyncExternalStore(subscribe, () => bootMode, () => null)
  // Mounted again after the sequence ended (the session reloading): no replay.
  const [late] = useState(() => bootMode !== null && !playing)
  useEffect(startBoot, [])
  const shown = late ? "still" : mode

  return (
    <div role="status" data-boot={shown ?? "pending"} className="relative min-h-dvh overflow-hidden bg-background text-foreground">
      {shown === "phosphore" && <PhosphoreBoot />}
      {shown === "cyanotype" && <CyanotypeBoot />}
      {shown === "studio" && <StudioBoot />}
      {shown === "still" && (
        <Centered>
          <Mark />
        </Centered>
      )}
    </div>
  )
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
}

/** Logo, name and a loading line: the end frame of every sequence. */
function Mark() {
  return (
    <div className="flex flex-col items-center gap-3">
      <TraceLogo size={44} className="text-primary" />
      <span className="text-lg font-semibold tracking-tight">AgentTrace</span>
      <span className="font-mono text-xs text-(--ink-2)">Loading</span>
    </div>
  )
}

/** CRT power-on: a bright line opens across, then into the screen, with a flash. */
function PhosphoreBoot() {
  return (
    <>
      <motion.div
        className="at-graticule absolute inset-0"
        style={{ backgroundColor: "var(--surface-1)" }}
        initial={{ clipPath: "inset(50% 0% 50% 0%)", filter: "brightness(2.4)" }}
        animate={{ clipPath: "inset(0% 0% 0% 0%)", filter: "brightness(1)" }}
        transition={{
          clipPath: { delay: 0.32, duration: 0.34, ease: EASE_OUT },
          filter: { delay: 0.32, duration: 0.6, ease: "easeOut" },
        }}
      />
      <motion.div
        className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2"
        style={{ background: "var(--ev-result)", boxShadow: "0 0 14px 2px var(--ev-result)" }}
        initial={{ scaleX: 0, opacity: 1 }}
        animate={{ scaleX: 1, opacity: 0 }}
        transition={{
          scaleX: { duration: 0.32, ease: EASE_OUT },
          opacity: { delay: 0.36, duration: 0.24, ease: "easeIn" },
        }}
      />
      <Centered>
        <motion.div className="at-glow" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.66, duration: 0.4 }}>
          <Mark />
        </motion.div>
      </Centered>
    </>
  )
}

const GRID = "color-mix(in oklab, var(--ink) 10%, transparent)"

/** Drafting sheet: the grid draws from the top-left, the double border strokes
 * in, then the title block is stamped. */
function CyanotypeBoot() {
  return (
    <>
      <motion.div
        className="absolute inset-0"
        style={{
          backgroundImage: `repeating-linear-gradient(to right, ${GRID} 0 1px, transparent 1px 24px), repeating-linear-gradient(to bottom, ${GRID} 0 1px, transparent 1px 24px)`,
          backgroundRepeat: "no-repeat",
        }}
        initial={{ backgroundSize: "0% 0%, 0% 0%" }}
        animate={{ backgroundSize: "100% 100%, 100% 100%" }}
        transition={{ duration: 0.5, ease: EASE_OUT }}
      />
      {[16, 22].map((inset, i) => (
        <svg key={inset} aria-hidden className="absolute" style={{ inset, width: `calc(100% - ${inset * 2}px)`, height: `calc(100% - ${inset * 2}px)` }}>
          {/* Twice the stroke width, half clipped by the svg: a crisp 1 px frame on its edge. */}
          <motion.rect
            width="100%"
            height="100%"
            fill="none"
            stroke="var(--line-strong)"
            strokeWidth={i === 0 ? 3 : 2}
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ delay: 0.3 + i * 0.08, duration: 0.42, ease: [0.4, 0, 0.6, 1] }}
          />
        </svg>
      ))}
      <Centered>
        <motion.div
          className="min-w-64 border border-(--line-strong) bg-(--surface-1)"
          style={{ borderRadius: "var(--radius-panel)" }}
          initial={{ opacity: 0, scale: 1.06 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.76, duration: 0.24, ease: EASE_OUT }}
        >
          <div className="flex items-center gap-3 px-5 py-4">
            <TraceLogo size={32} className="text-primary" />
            <span className="text-lg font-bold tracking-tight">AgentTrace</span>
          </div>
          <div className="grid grid-cols-[auto_1fr] border-t border-(--line-strong) font-mono text-[11px]">
            <span className="border-r border-(--line-strong) px-5 py-1.5 text-(--ink-2)">Sheet 1</span>
            <span className="px-3 py-1.5 text-(--ink-2)">Loading</span>
          </div>
        </motion.div>
      </Centered>
    </>
  )
}

const LEDS = ["var(--ev-handoff)", "var(--ev-llm)", "var(--ev-tool)", "var(--ev-result)"]

/** Studio: the four participant LEDs light in turn, then the panel slides up. */
function StudioBoot() {
  return (
    <Centered>
      <div className="flex gap-2.5" aria-hidden>
        {LEDS.map((color, i) => (
          <span key={color} className="relative h-2.5 w-2.5 rounded-full bg-(--line-strong)">
            <motion.span
              className="absolute inset-0 rounded-full"
              style={{ background: color, boxShadow: `0 0 0 3px color-mix(in oklab, ${color} 22%, transparent)` }}
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.05 + i * 0.13, type: "spring", stiffness: 380, damping: 26 }}
            />
          </span>
        ))}
      </div>
      <motion.div
        className="mt-5 border border-(--line) bg-(--surface-2) px-10 py-7"
        style={{ borderRadius: "var(--radius-panel)", boxShadow: "var(--shadow-raised)" }}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.62, duration: 0.4, ease: EASE_OUT }}
      >
        <Mark />
      </motion.div>
    </Centered>
  )
}
