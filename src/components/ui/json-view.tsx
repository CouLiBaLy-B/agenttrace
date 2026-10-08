"use client"

import { useMemo } from "react"
import { cn } from "@/lib/utils"

const TOKEN = /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false)\b|\b(null)\b|(\s+)|([{}[\],:])/g

export type JsonToken = { kind: "key" | "string" | "number" | "boolean" | "null" | "punct" | "space"; text: string }

/** Splits pretty-printed JSON into coloured tokens; joining their text gives the input back. */
export function tokenizeJson(text: string): JsonToken[] {
  const out: JsonToken[] = []
  for (const m of text.matchAll(TOKEN)) {
    if (m[1] !== undefined) {
      if (m[2] !== undefined) {
        out.push({ kind: "key", text: m[1] }, { kind: "punct", text: m[2] })
      } else out.push({ kind: "string", text: m[1] })
    } else if (m[3] !== undefined) out.push({ kind: "number", text: m[3] })
    else if (m[4] !== undefined) out.push({ kind: "boolean", text: m[4] })
    else if (m[5] !== undefined) out.push({ kind: "null", text: m[5] })
    else if (m[6] !== undefined) out.push({ kind: "space", text: m[6] })
    else out.push({ kind: "punct", text: m[7] })
  }
  return out
}

/** Token colours (text tokens; contrast on --surface-1 is unit-tested). */
export const JSON_TOKEN_COLOR: Record<JsonToken["kind"], string> = {
  key: "var(--ev-llm-text)",
  string: "var(--ev-result-text)",
  number: "var(--ev-handoff-text)",
  boolean: "var(--ev-tool-text)",
  null: "var(--ev-tool-text)",
  punct: "var(--ink-2)",
  space: "inherit",
}

/** The text JsonView shows (and "Copy JSON" copies) for a value. */
export function formatJson(value: unknown): string {
  return JSON.stringify(value ?? null, null, 2) ?? String(value)
}

/** A value as pretty-printed, syntax-coloured JSON in the data font. */
export function JsonView({ value, className }: { value: unknown; className?: string }) {
  const tokens = useMemo(() => tokenizeJson(formatJson(value)), [value])
  return (
    <pre
      className={cn(
        "font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words text-[var(--ink)]",
        className
      )}
    >
      {tokens.map((t, i) =>
        t.kind === "space" ? t.text : (
          <span key={i} style={{ color: JSON_TOKEN_COLOR[t.kind] }}>
            {t.text}
          </span>
        )
      )}
    </pre>
  )
}
