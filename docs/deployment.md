# Deployment

`agenttrace ui` is a standard FastAPI/uvicorn app. For anything beyond local
use, pick a database and a hosting setup.

## Database

By default AgentTrace uses a local SQLite file (`agenttrace.db`) — fine for a
single user on one machine. For shared or production use, point it at Postgres:

```bash
export DATABASE_URL="postgresql+psycopg://user:pass@host:5432/agenttrace"
agenttrace db init      # create tables once
agenttrace ui --host 0.0.0.0
```

| Profile | `DATABASE_URL` | When |
| --- | --- | --- |
| SQLite (default) | unset | local dev, single user |
| Postgres | `postgresql+psycopg://…` | shared, multi-user, production |

Run `agenttrace db init` once against a fresh database to create the schema.

## Serving

- Bind publicly with `--host 0.0.0.0 --port 3000`.
- Put it behind a reverse proxy (nginx/Caddy/Traefik) for TLS. Proxy both the
  HTTP API **and** the WebSocket (`/ws`) — the live diagram needs the upgrade
  headers forwarded.
- The frontend is served by the same process (static files) — no separate
  Node/Bun process.

## Scaling notes

- The ingestion endpoint (`POST /api/events`) is stateless per event; scale it
  horizontally behind the shared database.
- The live WebSocket fan-out is per-process (in-memory pub/sub by `run_id`).
  For multiple instances, use sticky sessions so a run's viewers land on the
  instance ingesting it, or externalize the fan-out.

## Client configuration

Wherever your agent runs, point `agenttrace-langchain` at the deployment:

```bash
export AGENTTRACE_URL="https://traces.example.com/api/events"
export AGENTTRACE_KEY="atr_..."
```

See [Middleware](integration-middleware.md) / [Callback handler](integration-callback.md).
