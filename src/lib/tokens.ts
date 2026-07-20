// Token usage helpers — shared across views.

export interface TokenUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

/**
 * Extract token usage from an event payload.
 *
 * Supports several shapes agents commonly send:
 *   { prompt_tokens, completion_tokens, total_tokens }   ← OpenAI / LangChain standard
 *   { tokens: N }                                          ← legacy single-number
 *   { token_usage: { ... } }                               ← LangChain llm_output wrapper
 *   { usage: { prompt_tokens, completion_tokens, total } } ← Anthropic-style
 */
export function extractTokens(payload: any): TokenUsage | null {
  if (!payload || typeof payload !== "object") return null

  // direct standard shape
  if (
    typeof payload.prompt_tokens === "number" ||
    typeof payload.completion_tokens === "number" ||
    typeof payload.total_tokens === "number"
  ) {
    const p = payload.prompt_tokens ?? 0
    const c = payload.completion_tokens ?? 0
    return {
      prompt_tokens: p,
      completion_tokens: c,
      total_tokens: payload.total_tokens ?? p + c,
    }
  }

  // langchain llm_output.token_usage
  const tu = payload.token_usage || payload.usage
  if (tu && typeof tu === "object") {
    const p = tu.prompt_tokens ?? tu.input_tokens ?? 0
    const c = tu.completion_tokens ?? tu.output_tokens ?? 0
    const t = tu.total_tokens ?? tu.total ?? p + c
    if (p || c || t) {
      return { prompt_tokens: p, completion_tokens: c, total_tokens: t }
    }
  }

  // legacy single number
  if (typeof payload.tokens === "number") {
    return {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: payload.tokens,
    }
  }

  return null
}

/** Human-readable token count, e.g. 1240 → "1.2k", 184 → "184". */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1000000) return (n / 1000).toFixed(n < 10000 ? 1 : 0) + "k"
  return (n / 1000000).toFixed(1) + "M"
}

/** Sum token usage across an array of events (only llm_call carry tokens). */
export function sumTokens(events: { type: string; payload: any }[]): TokenUsage {
  return events.reduce(
    (acc, ev) => {
      if (ev.type !== "llm_call") return acc
      const t = extractTokens(ev.payload)
      if (!t) return acc
      return {
        prompt_tokens: acc.prompt_tokens + t.prompt_tokens,
        completion_tokens: acc.completion_tokens + t.completion_tokens,
        total_tokens: acc.total_tokens + t.total_tokens,
      }
    },
    { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
  )
}
