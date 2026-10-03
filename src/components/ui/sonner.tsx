"use client"

import { Toaster as Sonner, ToasterProps } from "sonner"

// Providers passes the light/dark variant of the active theme. Plain toasts take
// the theme's popover colours, font and corner radius; the rich success/error
// colours are sonner's own light/dark palettes.
const Toaster = (props: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius-panel)",
          fontFamily: "var(--font-ui)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
