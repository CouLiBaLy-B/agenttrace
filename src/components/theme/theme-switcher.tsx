"use client"

import type { MouseEvent, ReactNode } from "react"
import { Monitor } from "lucide-react"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { THEME_IDS, THEME_LABELS, revealOrigin, useTheme, type ThemePreference } from "@/lib/theme"

/** A swatch button. Its name shows in a tooltip on hover and on keyboard focus
 * (and is its accessible name). */
function ChoiceButton({
  label,
  side,
  pressed,
  onClick,
  children,
}: {
  label: string
  side: "top" | "right"
  pressed: boolean
  onClick: (e: MouseEvent<HTMLButtonElement>) => void
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={pressed}
          onClick={onClick}
          className={cn(
            "grid size-7 shrink-0 place-items-center rounded-[var(--radius-control)] border-2 transition-colors",
            "hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            pressed ? "border-primary" : "border-transparent"
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side={side} sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

/** Auto plus one swatch per theme. Each swatch renders inside its own
 * data-theme, so it reads that theme's surface and event colours (and its
 * corner radius) whichever theme is active. */
export function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const preference = useTheme((s) => s.preference)
  const setPreference = useTheme((s) => s.setPreference)
  const side = compact ? "right" : "top"
  const choose = (pref: ThemePreference) => (e: MouseEvent<HTMLButtonElement>) => setPreference(pref, revealOrigin(e))

  return (
    <div
      role="group"
      aria-label="Theme"
      className={cn("flex items-center", compact ? "flex-col gap-1" : "justify-between gap-2")}
    >
      {!compact && (
        <span aria-hidden className="truncate text-xs text-muted-foreground">
          Theme
        </span>
      )}
      <div className={cn("flex gap-1", compact && "flex-col")}>
        <ChoiceButton label="Auto (follows your system)" side={side} pressed={preference === "auto"} onClick={choose("auto")}>
          <span
            aria-hidden
            className="grid size-5 place-items-center rounded-[var(--radius-control)] border border-sidebar-border bg-sidebar-accent text-muted-foreground"
          >
            <Monitor className="size-3.5" />
          </span>
        </ChoiceButton>
        {THEME_IDS.map((id) => (
          <ChoiceButton key={id} label={THEME_LABELS[id]} side={side} pressed={preference === id} onClick={choose(id)}>
            <span
              data-theme={id}
              aria-hidden
              className="grid size-5 grid-cols-2 grid-rows-2 overflow-hidden rounded-[var(--radius-control)] border"
            >
              <span className="row-span-2 bg-[var(--surface-0)]" />
              <span className="bg-[var(--ev-result)]" />
              <span className="bg-[var(--ev-handoff)]" />
            </span>
          </ChoiceButton>
        ))}
      </div>
    </div>
  )
}
