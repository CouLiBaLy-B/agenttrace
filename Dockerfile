# ──────────────────────────────────────────────────────────────────────
# AgentTrace — multi-stage Dockerfile
# Produces two final images: `agenttrace-web` (Next.js standalone) and
# `agenttrace-socket` (Socket.IO service). Built via docker-compose.
# ──────────────────────────────────────────────────────────────────────

# ----- base: install all deps with bun -----
FROM oven/bun:1.3 AS deps
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# ----- builder: build the Next.js standalone output -----
FROM oven/bun:1.3 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Build-time only: prisma.config.ts requires DATABASE_URL (v7 env() is strict),
# but generate/build never connect. Real URL is injected at runtime by compose.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
# Prisma client must be generated before the build
RUN bun run db:generate
RUN bun run build

# ----- web (Next.js standalone) -----
# `output: "standalone"` in next.config.ts produces a self-contained server
# at .next/standalone that only needs .next/static + public copied in.
FROM oven/bun:1.3 AS web
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# Prisma 7: schema + config are needed at runtime for `prisma db push` on boot.
# (The generated client is Rust-free and already bundled into the standalone output.)
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
# Overlay the full dependency tree from the same lockfile so the Prisma CLI and
# ALL its transitive deps (e.g. `effect` via @prisma/config) resolve at boot for
# `prisma db push`. The standalone server bundles its own runtime deps; this is a
# version-matched superset. Call the local bin directly — never `bunx` (which
# would re-download prisma@latest on every boot).
COPY --from=deps /app/node_modules ./node_modules

EXPOSE 3000
# Apply the Prisma schema to Postgres on boot (idempotent), then start the server.
CMD ["sh", "-c", "./node_modules/.bin/prisma db push && bun server.js"]

# ----- socket (Socket.IO mini-service) -----
FROM oven/bun:1.3 AS socket
WORKDIR /app
ENV NODE_ENV=production
ENV SOCKET_SERVICE_PORT=3003

COPY mini-services/socket-service/package.json ./
COPY mini-services/socket-service/index.ts ./
RUN bun install --frozen-lockfile 2>/dev/null || bun install

EXPOSE 3003
CMD ["bun", "run", "start"]
