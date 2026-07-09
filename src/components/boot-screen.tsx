"use client"

export function BootScreen() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center at-graticule at-scanlines relative overflow-hidden">
      <div className="relative">
        <svg width="64" height="64" viewBox="0 0 64 64" className="text-primary">
          <circle cx="32" cy="32" r="28" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.4" />
          <circle cx="32" cy="32" r="20" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.6" />
          <path
            d="M6 32 L18 32 L22 18 L28 46 L34 24 L40 38 L46 32 L58 32"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="at-glow"
          />
        </svg>
      </div>
      <p className="mt-6 font-mono text-xs tracking-[0.3em] text-primary/70 at-glow uppercase">
        initializing trace
      </p>
      <div className="mt-3 flex gap-1">
        <span className="h-1.5 w-1.5 rounded-full bg-primary at-blink" style={{ animationDelay: "0ms" }} />
        <span className="h-1.5 w-1.5 rounded-full bg-primary at-blink" style={{ animationDelay: "200ms" }} />
        <span className="h-1.5 w-1.5 rounded-full bg-primary at-blink" style={{ animationDelay: "400ms" }} />
      </div>
    </div>
  )
}
