import { eventPaint } from "@/lib/types"
import { cn } from "@/lib/utils"

/** The badge's fill: the event colour at this share over the surface. At 6 %
 * the event text colour on it keeps 4.5:1 in every theme on --surface-1 and
 * --surface-2 (8 % drops Cyanotype's error to 4.45:1 on --surface-2);
 * unit-tested in inspector-contrast.test.ts. */
export const BADGE_TINT = 0.06

/** An event's type as a small tinted badge, in its event text colour. */
export function EventBadge({ type, status, className }: { type: string; status?: string; className?: string }) {
  const meta = eventPaint(type, status === "error")
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-[var(--radius-control)] border px-1.5 py-px text-[11px] font-semibold leading-4 whitespace-nowrap",
        className
      )}
      style={{
        color: meta.text,
        background: `color-mix(in srgb, ${meta.color} ${BADGE_TINT * 100}%, transparent)`,
        borderColor: `color-mix(in srgb, ${meta.color} 35%, transparent)`,
      }}
    >
      {meta.label}
    </span>
  )
}
