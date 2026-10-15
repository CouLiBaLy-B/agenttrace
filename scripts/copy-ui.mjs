// Copy the static export (out/) into the Python package so the wheel ships
// the dashboard: python-server/lanetrace/server/static/.
import { cpSync, existsSync, readFileSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const src = join(root, "out")
const dest = join(root, "python-server", "lanetrace", "server", "static")

// NEXT_PUBLIC_* values are inlined at build time: a dev-only WebSocket URL
// would be baked into the shipped bundle and break /ws for every install.
const WS_VAR = "NEXT_PUBLIC_AGENTTRACE_WS_URL"
const envFiles = [".env", ".env.production", ".env.local", ".env.production.local"].filter((f) =>
  existsSync(join(root, f)) &&
  readFileSync(join(root, f), "utf8")
    .split(/\r?\n/)
    .some((line) => new RegExp(`^\\s*(export\\s+)?${WS_VAR}\\s*=\\s*\\S`).test(line))
)
if (process.env[WS_VAR] || envFiles.length) {
  const where = process.env[WS_VAR] ? "the environment" : envFiles.join(", ")
  console.error(
    `[lanetrace] ${WS_VAR} is set (in ${where}) — it would be inlined into the shipped bundle. ` +
      "Unset it (it is for `bun run dev` only) and re-run `bun run build:ui`."
  )
  process.exit(1)
}

if (!existsSync(join(src, "index.html"))) {
  console.error("out/index.html not found — did `next build` run with output: export?")
  process.exit(1)
}
rmSync(dest, { recursive: true, force: true })
cpSync(src, dest, { recursive: true })
console.log(`[lanetrace] UI bundle copied to ${dest}`)
