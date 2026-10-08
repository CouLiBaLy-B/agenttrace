"use client"

import { useMemo, useState } from "react"
import { cn } from "@/lib/utils"

const TOKEN = /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false)\b|\b(null)\b|(\s+)|([{}[\],:])/g

export type JsonToken = { kind: "key" | "string" | "number" | "boolean" | "null" | "punct" | "space"; text: string }

/** Splits pretty-printed JSON into coloured tokens; joining their text gives the
 * input back. With a `limit`, stops after that many tokens (the regex runs lazily). */
export function tokenizeJson(text: string, limit = Infinity): JsonToken[] {
  const out: JsonToken[] = []
  for (const m of text.matchAll(TOKEN)) {
    if (out.length >= limit) break
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
  // A key pushes two tokens at once.
  return out.length > limit ? out.slice(0, limit) : out
}

/** Above either limit a payload is previewed: its first JSON_PREVIEW_TOKENS tokens
 * highlighted, the full text on request as plain text (one span per token would
 * freeze the inspector on a megabyte payload). */
export const JSON_MAX_CHARS = 100_000
export const JSON_MAX_TOKENS = 20_000
export const JSON_PREVIEW_TOKENS = 2_000

/** What JsonView highlights for a formatted payload, and whether that is only its start. */
export function planJsonView(text: string): { tokens: JsonToken[]; truncated: boolean } {
  if (text.length > JSON_MAX_CHARS) return { tokens: tokenizeJson(text, JSON_PREVIEW_TOKENS), truncated: true }
  const tokens = tokenizeJson(text, JSON_MAX_TOKENS + 1)
  if (tokens.length > JSON_MAX_TOKENS) return { tokens: tokens.slice(0, JSON_PREVIEW_TOKENS), truncated: true }
  return { tokens, truncated: false }
}

function formatSize(chars: number): string {
  return chars >= 1_000_000 ? `${(chars / 1_000_000).toFixed(1)} MB` : `${Math.round(chars / 1000)} KB`
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

/** A value as pretty-printed, syntax-coloured JSON in the data font. A large
 * value shows a highlighted preview and a "Show full payload" control. */
export function JsonView({ value, className }: { value: unknown; className?: string }) {
  const text = useMemo(() => formatJson(value), [value])
  const plan = useMemo(() => planJsonView(text), [text])
  const [full, setFull] = useState(false)
  const pre = cn("font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words text-[var(--ink)]", className)

  if (full) return <FullText text={text} className={pre} />
  return (
    <div className="space-y-1.5">
      {plan.truncated && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--ink-2)]">
          Showing the start of a {formatSize(text.length)} payload.
          <button
            type="button"
            onClick={() => setFull(true)}
            className="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--line)] px-2 text-[var(--ink)] transition-colors hover:bg-[var(--surface-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
          >
            Show full payload
          </button>
        </p>
      )}
      <pre className={pre}>
        {plan.tokens.map((t, i) =>
          t.kind === "space" ? t.text : (
            <span key={i} style={{ color: JSON_TOKEN_COLOR[t.kind] }}>
              {t.text}
            </span>
          )
        )}
        {plan.truncated && <span className="text-[var(--ink-2)]">{"\n…"}</span>}
      </pre>
    </div>
  )
}

const CHUNK_LINES = 400

/** The whole payload as plain text, in blocks of lines the browser may skip laying
 * out while they are scrolled away (content-visibility), so a megabyte opens quickly. */
function FullText({ text, className }: { text: string; className: string }) {
  const chunks = useMemo(() => {
    const lines = text.split("\n")
    const out: { text: string; lines: number }[] = []
    for (let i = 0; i < lines.length; i += CHUNK_LINES) {
      const part = lines.slice(i, i + CHUNK_LINES)
      out.push({ text: part.join("\n") + (i + CHUNK_LINES < lines.length ? "\n" : ""), lines: part.length })
    }
    return out
  }, [text])
  return (
    <pre className={className}>
      {chunks.map((c, i) => (
        <span
          key={i}
          className="block"
          style={{ contentVisibility: "auto", containIntrinsicSize: `auto ${Math.round(c.lines * 1.625 * 11)}px` }}
        >
          {c.text}
        </span>
      ))}
    </pre>
  )
}
