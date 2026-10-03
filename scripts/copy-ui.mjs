// Copy the static export (out/) into the Python package so the wheel ships
// the dashboard: python-server/agenttrace/server/static/.
import { cpSync, existsSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const src = join(root, "out")
const dest = join(root, "python-server", "agenttrace", "server", "static")

if (!existsSync(join(src, "index.html"))) {
  console.error("out/index.html not found — did `next build` run with output: export?")
  process.exit(1)
}
rmSync(dest, { recursive: true, force: true })
cpSync(src, dest, { recursive: true })
console.log(`[agenttrace] UI bundle copied to ${dest}`)
