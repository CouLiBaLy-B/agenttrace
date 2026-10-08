"use client"

import { useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from "react"
import { Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { THEME_LABELS, revealOrigin, useTheme, type ThemeId, type ThemePreference } from "@/lib/theme"
import { DemoLoop } from "@/components/demo/demo-loop"

const PREVIEW_H = 160

const CHOICES: { id: ThemePreference; name: string; description: string }[] = [
  { id: "auto", name: "Auto", description: "Follows your system: Studio in light mode, Cyanotype in dark mode" },
  {
    id: "phosphore",
    name: THEME_LABELS.phosphore,
    description: "A measuring instrument: glowing signals that fade like a CRT trace.",
  },
  {
    id: "cyanotype",
    name: THEME_LABELS.cyanotype,
    description: "An engineering drawing: Prussian-blue sheet, dimension lines, a title block.",
  },
  { id: "studio", name: THEME_LABELS.studio, description: "A light hardware instrument: key colours, springy arrows, LEDs." },
]

/** One theme's colours, read inside its own data-theme: its surface, ink and event strokes. */
function Swatch({ theme, caption }: { theme: ThemeId; caption: string }) {
  return (
    <div
      data-theme={theme}
      className="flex min-w-0 flex-1 flex-col justify-between gap-3 bg-[var(--surface-0)] p-3 font-sans text-[var(--ink)]"
    >
      <div className="space-y-2" aria-hidden>
        {(["handoff", "llm", "tool", "result"] as const).map((k, i) => (
          <span
            key={k}
            className="block h-[3px] rounded-full"
            style={{ background: `var(--ev-${k})`, width: `${88 - i * 14}%`, marginLeft: `${i * 4}%` }}
          />
        ))}
      </div>
      <div>
        <p className="text-[11px] text-[var(--ink-2)]">{caption}</p>
        <p className="text-sm font-semibold">{THEME_LABELS[theme]}</p>
      </div>
    </div>
  )
}

function Preview({ id }: { id: ThemePreference }) {
  if (id === "auto") {
    return (
      <div className="flex h-full divide-x divide-[var(--line)]">
        <Swatch theme="studio" caption="Light mode" />
        <Swatch theme="cyanotype" caption="Dark mode" />
      </div>
    )
  }
  return (
    <div data-theme={id} className="at-canvas h-full">
      <DemoLoop theme={id} preview fitHeight={PREVIEW_H} />
    </div>
  )
}

function ChoiceCard({
  name,
  description,
  checked,
  onSelect,
  onKeyDown,
  buttonRef,
  children,
}: {
  name: string
  description: string
  checked: boolean
  onSelect: (e: MouseEvent<HTMLButtonElement>) => void
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void
  buttonRef: (el: HTMLButtonElement | null) => void
  children: ReactNode
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      role="radio"
      aria-checked={checked}
      tabIndex={checked ? 0 : -1}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      className={cn(
        "group flex min-w-0 flex-col overflow-hidden rounded-[var(--radius-panel)] border bg-[var(--surface-1)] text-left transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
        checked
          ? "border-[var(--action)] ring-1 ring-[var(--action)]"
          : "border-[var(--line)] hover:border-[var(--line-strong)]"
      )}
    >
      <div className="relative overflow-hidden border-b border-[var(--line)]" style={{ height: PREVIEW_H }}>
        {children}
      </div>
      <div className="flex items-start gap-3 p-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[var(--ink)]">{name}</p>
          <p className="mt-0.5 text-xs leading-snug text-[var(--ink-2)]">{description}</p>
        </div>
        <span
          aria-hidden
          className={cn(
            "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border",
            checked ? "border-[var(--action)] bg-[var(--action)] text-[var(--on-action)]" : "border-[var(--line-strong)]"
          )}
        >
          {checked && <Check className="size-3.5" strokeWidth={3} />}
        </span>
      </div>
    </button>
  )
}

/** Settings › Appearance: Auto and the three themes, each playing the refund run
 * in its own style. A radio group: arrow keys move the choice. */
export function ThemePicker({ labelledBy }: { labelledBy: string }) {
  const preference = useTheme((s) => s.preference)
  const setPreference = useTheme((s) => s.setPreference)
  const buttons = useRef<(HTMLButtonElement | null)[]>([])

  const onKeyDown = (index: number) => (e: KeyboardEvent<HTMLButtonElement>) => {
    const last = CHOICES.length - 1
    const next =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? index === last ? 0 : index + 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? index === 0 ? last : index - 1
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? last
              : null
    if (next === null) return
    e.preventDefault()
    const el = buttons.current[next]
    el?.focus()
    if (el) setPreference(CHOICES[next].id, revealOrigin({ detail: 0, clientX: 0, clientY: 0, currentTarget: el }))
  }

  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className="grid gap-3 sm:grid-cols-2">
      {CHOICES.map((c, i) => (
        <ChoiceCard
          key={c.id}
          name={c.name}
          description={c.description}
          checked={preference === c.id}
          onSelect={(e) => setPreference(c.id, revealOrigin(e))}
          onKeyDown={onKeyDown(i)}
          buttonRef={(el) => {
            buttons.current[i] = el
          }}
        >
          <Preview id={c.id} />
        </ChoiceCard>
      ))}
    </div>
  )
}
