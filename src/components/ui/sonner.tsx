"use client"

import { Toaster as Sonner, ToasterProps } from "sonner"

// Rich toasts: coloured text and icon on the popover colour, so every theme
// gets legible, on-brand toasts instead of sonner's built-in light/dark
// palettes (the light error and success text fail 4.5:1). The pairs are
// unit-tested in themes.test.ts ("toast text reaches 4.5:1 on surface-2").
const RICH_TEXT = {
  success: "--action",
  error: "--danger",
  info: "--ev-llm-text",
  warning: "--ev-handoff-text",
}
const richColors = Object.fromEntries(
  Object.entries(RICH_TEXT).flatMap(([type, token]) => [
    [`--${type}-bg`, "var(--popover)"],
    [`--${type}-border`, "var(--line)"],
    [`--${type}-text`, `var(${token})`],
  ]),
)

// Providers passes the light/dark variant of the active theme; it only selects
// sonner's neutral greys (close-button hover, loading spinner). Colours, font
// and corner radius come from the theme tokens.
const Toaster = (props: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          ...richColors,
          "--border-radius": "var(--radius-panel)",
          fontFamily: "var(--font-ui)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
