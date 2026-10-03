# deepagents-trace (Python server + CLI)

PyPI distribution name: **`deepagents-trace`** (the `agenttrace` name is
already taken on PyPI by an unrelated project — TensorStax's own agent-tracing
tool — so this package is published under a different name; the importable
module, the CLI command, and the product itself are still called
`agenttrace`/AgentTrace).

`pip install 'deepagents-trace[server]' && agenttrace ui` — starts the AgentTrace web
API (and a `/ws` live-stream) with **zero Node/Bun process**, `mlflow ui`-style.
For local development against this checkout: `pip install -e "python-server[dev]"`.

This is **Phase 1 + 3** of the Python migration plan: a FastAPI backend that
is a 1:1 contract port of the Next.js API (`src/app/api/*` in the main repo),
plus the CLI. **Phase 2 is not done yet** — there is no bundled frontend, so
`/` currently serves a placeholder page confirming the API is up; use the API
directly (`/api/*`) or the existing Next.js dashboard against this backend's
data once Phase 2 lands.

## Quick start (MLflow-style)

```bash
pip install 'deepagents-trace[langchain,server]'
```

```python
import agenttrace
import agenttrace.langchain

agenttrace.set_project("support-bot")      # like mlflow.set_experiment
agenttrace.langchain.autolog()             # like mlflow.langchain.autolog
agent.invoke({"messages": [...]})          # traced into ./agenttrace.db
```

```bash
agenttrace ui                              # http://127.0.0.1:3000, reads ./agenttrace.db, no login
```

Manual tracing:

```python
with agenttrace.start_run("triage"):
    agenttrace.log_event(source="Orchestrator", target="LLM", type="llm_call", duration_ms=420)

@agenttrace.trace                          # tool_call -> tool_result | error
def web_search(query: str) -> str: ...
```

| MLflow | AgentTrace |
| --- | --- |
| `mlflow.set_tracking_uri()` / `MLFLOW_TRACKING_URI` | `agenttrace.set_tracking_uri()` / `AGENTTRACE_TRACKING_URI` |
| `mlflow.set_experiment()` | `agenttrace.set_project()` / `AGENTTRACE_PROJECT` |
| `mlflow.start_run()` / `active_run()` / `end_run()` | same names |
| `@mlflow.trace` | `@agenttrace.trace` |
| `mlflow.langchain.autolog()` | `agenttrace.langchain.autolog()` |
| `MlflowClient` | `agenttrace.AgentTraceClient` |
| `mlflow ui` | `agenttrace ui` |

Tracking URIs: unset -> `sqlite:///./agenttrace.db`; any SQLAlchemy URL (e.g.
`postgresql://...`) -> written directly; `http(s)://host:port` -> sent to a
running `agenttrace ui` (set `AGENTTRACE_KEY` if that server uses
`--auth password`). The legacy `AGENTTRACE_URL` is still honored as a fallback.

`agenttrace ui --auth none` (default on localhost) needs no account or API
key; in this mode the server only accepts loopback `Host`/`Origin` headers.
When serving behind a reverse proxy, add the public hostnames with
`AGENTTRACE_ALLOWED_HOSTS` (comma-separated). `--auth password` (default on any
other host) keeps accounts and `atr_` project keys, and `/ws` requires a
session cookie.

To serve another database, or listen on another port/interface:

```bash
agenttrace ui --database-url postgresql://user:pass@localhost:5432/agenttrace
agenttrace ui --port 8080 --host 0.0.0.0
```

`agenttrace db init` creates the schema explicitly (also runs automatically
on `agenttrace ui` startup) — schema-push style (`Base.metadata.create_all`),
matching how this repo already runs `prisma db push` rather than migrations.

## Upgrading from 0.1

- The server is now the `[server]` extra: `pip install 'deepagents-trace[server]'`
  (the core package only carries the tracking SDK: SQLAlchemy, requests, click).
- On localhost, `agenttrace ui` now defaults to `--auth none`: no login, and
  everything is owned by a single local user, so projects created under
  existing accounts are hidden. Start it with `agenttrace ui --auth password`
  to keep using accounts and `atr_` keys.
- `agenttrace-langchain` is now a deprecation shim over `agenttrace.langchain`
  (`pip install 'deepagents-trace[langchain]'`); old imports keep working.
- If only `AGENTTRACE_KEY` is set (no `AGENTTRACE_TRACKING_URI`/`AGENTTRACE_URL`),
  traces still go to the pre-0.2 default server `http://localhost:3000`
  (a warning is logged once); set `AGENTTRACE_TRACKING_URI` to choose explicitly.
- `AgentTraceRun.emit` now raises `ValueError` on an invalid event type
  instead of silently dropping the event.

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

## Publishing to PyPI

Packaging is ready and verified (`python -m build` + `twine check dist/*`
both pass; the built wheel installs and runs standalone in a clean venv).
`.github/workflows/publish-pypi.yml` builds and publishes on every GitHub
Release, using **PyPI Trusted Publishing (OIDC)** — no API token stored as a
GitHub secret. What's left requires your PyPI account, so it can't be done
from here:

1. Create a PyPI account (https://pypi.org/account/register/) if you don't
   have one, and enable 2FA (PyPI requires it).
2. Since `deepagents-trace` doesn't exist on PyPI yet, register it as a
   **pending publisher** (Publishing → Trusted publishers →
   "Add a pending publisher" at https://pypi.org/manage/account/publishing/):
   - PyPI project name: `deepagents-trace`
   - Owner: `CouLiBaLy-B`, Repository: `agenttrace`
   - Workflow filename: `publish-pypi.yml`
   - Environment name: `pypi`
3. In the GitHub repo settings, create an environment named `pypi` (Settings
   → Environments) — optionally with a required reviewer, so publishing needs
   manual approval.
4. Bump `version` in `pyproject.toml`, commit, then create a GitHub Release
   (tag `v0.1.0`) — the workflow builds and publishes automatically. First
   publish finalizes the pending publisher into a real one.
5. (Optional but recommended) do a dry run against TestPyPI first
   (https://test.pypi.org) with the same trusted-publisher flow before the
   real release.

## Known gaps vs. the Next.js backend (tracked for later phases)

- No frontend bundle yet (Phase 2).
- Live updates are polled from the database every 0.5 s (so direct SQLite writes appear live).
- No demo-account seeding on signup (the Next.js version seeds 3 sample
  projects — intentionally skipped here to keep this phase scoped to the API
  contract).
- Realtime wire protocol is plain JSON over `/ws`, not the Socket.IO
  protocol — the current React frontend's `socket.io-client` won't talk to
  it until Phase 2 adapts it.
