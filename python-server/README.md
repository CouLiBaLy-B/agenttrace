# agenttrace (Python server + CLI)

`pip install -e python-server && agenttrace ui` — starts the AgentTrace web
API (and a `/ws` live-stream) with **zero Node/Bun process**, `mlflow ui`-style.

This is **Phase 1 + 3** of the Python migration plan: a FastAPI backend that
is a 1:1 contract port of the Next.js API (`src/app/api/*` in the main repo),
plus the CLI. **Phase 2 is not done yet** — there is no bundled frontend, so
`/` currently serves a placeholder page confirming the API is up; use the API
directly (`/api/*`) or the existing Next.js dashboard against this backend's
data once Phase 2 lands.

## Install & run

```bash
pip install -e python-server
agenttrace ui                      # http://127.0.0.1:3000, SQLite by default (./agenttrace.db)
agenttrace ui --database-url postgresql://user:pass@localhost:5432/agenttrace
agenttrace ui --port 8080 --host 0.0.0.0
```

`agenttrace db init` creates the schema explicitly (also runs automatically
on `agenttrace ui` startup) — schema-push style (`Base.metadata.create_all`),
matching how this repo already runs `prisma db push` rather than migrations.

## What's ported

| Next.js (`src/`) | Python (`agenttrace/server/`) |
| --- | --- |
| `prisma/schema.prisma` | `models.py` (SQLAlchemy) — same `User/Project/Run/Event/ApiKey` shape |
| `src/lib/auth.ts` (NextAuth) | `routes/auth.py` + `security.py` — signed-cookie session (not NextAuth wire-compatible) |
| `src/lib/api-auth.ts`, `src/lib/keys.ts` | `deps.py`, `security.py` — same `atr_<32 hex>` key format/hash |
| `src/app/api/**/route.ts` | `routes/{projects,runs,events,keys,stats}.py` — same JSON shapes |
| `mini-services/socket-service` (Socket.IO) | `realtime.py` (`/ws`, plain JSON protocol — see its docstring) |

The `POST /api/events` contract (the one `integrations/agenttrace-langchain`
depends on) is unchanged: same fields, same `atr_` key auth, same event
types.

## Tests

```bash
pip install -e "python-server[dev]"
pytest python-server/tests
```

## Known gaps vs. the Next.js backend (tracked for later phases)

- No frontend bundle yet (Phase 2).
- No demo-account seeding on signup (the Next.js version seeds 3 sample
  projects — intentionally skipped here to keep this phase scoped to the API
  contract).
- Realtime wire protocol is plain JSON over `/ws`, not the Socket.IO
  protocol — the current React frontend's `socket.io-client` won't talk to
  it until Phase 2 adapts it.
