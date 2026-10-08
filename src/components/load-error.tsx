import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/** A query that failed: what couldn't load, how to fix it, and a retry. */
export function LoadError({
  what,
  onRetry,
  framed = true,
  className,
}: {
  /** What failed to load, as it reads after "Couldn't load", e.g. "your projects". */
  what: string
  onRetry: () => unknown
  /** Draw the panel border (off where the error sits inside a panel already). */
  framed?: boolean
  className?: string
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 text-sm text-[var(--ink-2)]",
        framed && "rounded-[var(--radius-panel)] border border-[var(--line)] px-4 py-3",
        className
      )}
    >
      <span>
        Couldn&apos;t load {what}. Check that <code className="font-mono text-[0.92em] text-[var(--ink)]">agenttrace ui</code>{" "}
        is running, then retry.
      </span>
      <Button size="sm" variant="outline" onClick={() => onRetry()}>
        Retry
      </Button>
    </div>
  )
}
