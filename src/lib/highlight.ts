// A small line-based highlighter for the Integration snippets (Python, TS,
// shell, JSON-ish). Not a parser: it knows quoted strings, `#` / `//`
// comments, object keys, keyword arguments and command-line flags.

export type TokenKind = "plain" | "comment" | "string" | "key"
export interface Token {
  kind: TokenKind
  text: string
}

const QUOTES = new Set(['"', "'", "`"])
const IDENT = /^[A-Za-z_$][\w$]*/
const FLAG = /^--?[A-Za-z][\w-]*/

/** The end (exclusive) of the string opening at `start`; the line's end when unclosed. */
function stringEnd(line: string, start: number): number {
  const quote = line[start]
  for (let i = start + 1; i < line.length; i++) {
    if (line[i] === "\\") i++
    else if (line[i] === quote) return i + 1
  }
  return line.length
}

/** Splits one line into tokens whose texts join back into the line. */
export function highlightLine(line: string): Token[] {
  const tokens: Token[] = []
  const push = (kind: TokenKind, text: string) => {
    const last = tokens.at(-1)
    if (kind === "plain" && last?.kind === "plain") last.text += text
    else tokens.push({ kind, text })
  }

  let i = 0
  while (i < line.length) {
    const ch = line[i]
    const rest = line.slice(i)
    const atWordStart = i === 0 || /\s/.test(line[i - 1])

    if (QUOTES.has(ch)) {
      const end = stringEnd(line, i)
      const text = line.slice(i, end)
      push(/^\s*:(?!:)/.test(line.slice(end)) ? "key" : "string", text)
      i = end
    } else if (atWordStart && (ch === "#" || rest.startsWith("//"))) {
      push("comment", rest)
      i = line.length
    } else if (atWordStart && ch === "-" && FLAG.test(rest)) {
      const flag = rest.match(FLAG)![0]
      push("key", flag)
      i += flag.length
    } else if (IDENT.test(rest) && !/[\w$]/.test(line[i - 1] ?? "")) {
      const word = rest.match(IDENT)![0]
      const after = line.slice(i + word.length)
      // `name: value` (an object key) or `name=value` (a keyword argument).
      push(/^:\s/.test(after) || /^=(?!=)/.test(after) ? "key" : "plain", word)
      i += word.length
    } else {
      push("plain", ch)
      i++
    }
  }
  return tokens
}
