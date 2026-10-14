/** The AgentTrace mark: a signal trace in a frame, drawn in `currentColor`. */
export function TraceLogo({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>
      <rect x="2" y="2" width="20" height="20" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
      <path
        d="M2 12 L7 12 L9 7 L11 17 L13 9 L15 15 L17 12 L22 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
