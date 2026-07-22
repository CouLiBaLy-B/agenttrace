# CLI reference

Installed with `deepagents-trace`. The entry point is `agenttrace`.

## `agenttrace ui`

Start the web UI + API + live-stream WebSocket, serving the pre-built frontend.

```bash
agenttrace ui [--host 127.0.0.1] [--port 3000] [--database-url URL]
```

| Option | Default | Description |
| --- | --- | --- |
| `--host` | `127.0.0.1` | Bind address. Use `0.0.0.0` to expose on the network. |
| `--port` | `3000` | Port to serve on. |
| `--database-url` | `DATABASE_URL` env, else SQLite | SQLAlchemy database URL. |

On launch it prints a banner with the resolved URL, API, WebSocket, database
(credentials masked), and docs link. Stop with ++ctrl+c++.

## `agenttrace db init`

Create all tables if they don't already exist (schema-push style, no migration
history).

```bash
agenttrace db init [--database-url URL]
```

## `agenttrace --version`

Print the installed `deepagents-trace` version.

## Environment variables

| Variable | Used by | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `agenttrace ui`, `db init` | Database connection (SQLite file by default; Postgres for shared use). |

See [Deployment](deployment.md) for database and hosting guidance.
