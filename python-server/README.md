# deepagents-trace (Python server + CLI)

PyPI distribution name: **`deepagents-trace`** (the `agenttrace` name is
already taken on PyPI by an unrelated project — TensorStax's own agent-tracing
tool — so this package is published under a different name; the importable
module, the CLI command, and the product itself are still called
`agenttrace`/AgentTrace).

`pip install 'deepagents-trace[server]' && agenttrace ui` — starts the AgentTrace web
API (and a `/ws` live-stream) with **zero Node/Bun process**, `mlflow ui`-style.
For local development against this checkout: `pip install -e "python-server[dev]"`.

The bundled dashboard has three themes (Phosphore, Cyanotype, Studio); see [Themes](https://github.com/CouLiBaLy-B/agenttrace#themes).

The package contains a FastAPI backend (`/api/*`, plus a `/ws` live stream),
the CLI, the tracking SDK, and the **bundled dashboard**: the static Next.js
export is served by the same process at `/`, so nothing else needs to run.

```bash
agenttrace demo      # seed sample projects and runs (optional: --database-url URL)
agenttrace ui        # dashboard at http://127.0.0.1:3000
```

Where the bundled UI comes from: wheels published to PyPI (and built in CI)
already contain it, because CI builds the UI before building the wheel. For a
source install (`pip install -e python-server`), build it yourself with
`bun install && bun run build:ui` from the repo root, which writes
`python-server/agenttrace/server/static/` (git-ignored). Without it, `/` serves
a placeholder page and the API still works.

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

Runnable notebooks, offline (scripted models, a temporary SQLite file):
[`examples/notebooks/`](https://github.com/CouLiBaLy-B/agenttrace/tree/main/python-server/examples/notebooks)
covers autolog, the middleware and the fluent API, then the per-request async
handler below.

### Async servers (cached agent, one handler per request)

A server that compiles the agent once can't bake a per-run middleware into
it; attach a fresh async callback handler per request instead. It traces the
main agent and every deepagents sub-agent, and posts to a running
`agenttrace ui` (`AGENTTRACE_TRACKING_URI=http://host:port`, plus
`AGENTTRACE_KEY` with `--auth password`), or pass `client=`:

```python
from agenttrace.langchain import AsyncAgentTraceCallbackHandler
from agenttrace.tracking.async_http import AsyncHttpEventClient

client = AsyncHttpEventClient(url=..., api_key=..., client=httpx_async_client)  # optional
handler = AsyncAgentTraceCallbackHandler(session_id, client=client, phrases=_PHRASES, anonymizer=fn)
handler.on_user_message(query)        # then config={"callbacks": [handler]} on astream_events
handler.approval_required(info)       # HITL pause
await handler.finish(status, answer=report); await handler.aclose()
```

`anonymizer` sees every payload (dict), label (str) and the run name; if it
raises, the field is redacted, never sent unmasked. The 0.2.2 import
`from agenttrace_langchain import AgentTraceCallbackHandler, AsyncAgentTraceClient`
still works (deprecated).

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
rather than migrations.

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
- The Next.js backend (Prisma, NextAuth, Socket.IO) is gone. Data from an old
  Prisma database is not migrated: start a fresh FastAPI database.
- Docker / `docker compose` users:
  - the old `web` and `socket` services are gone (one `agenttrace` service
    replaces them): run `docker compose up --build --remove-orphans` to remove
    their stale containers;
  - `NEXTAUTH_SECRET` is replaced by `AGENTTRACE_SECRET`, which compose now
    requires (it refuses to start without it);
  - reusing the old `pgdata` volume keeps the orphan Prisma tables (`"User"`,
    `"Project"`, `"Run"`, `"Event"`, `"ApiKey"`, `"Account"`, `"Session"`,
    `"VerificationToken"`) next to the new `users`/`projects`/`runs`/`events`/
    `api_keys` tables: old data is not visible in the new UI. Start from a
    fresh volume (`docker compose down -v` deletes it) or drop those tables;
  - Postgres port 5432 is no longer published on the host (only the
    `agenttrace` service on 3000 is); add a `ports:` entry to `db` if you
    need host access.
- `AgentTraceRun.emit` now raises `ValueError` on an invalid event type
  instead of silently dropping the event.

## What's ported (from the pre-0.2 Next.js backend)

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

End-to-end (Playwright, needs the built UI):

```bash
pip install -e "python-server[dev,e2e]" && playwright install chromium
bun run build:ui
pytest python-server/tests_e2e
```

## Publishing

Two PyPI projects are released from this repo, each by pushing a tag. Both
workflows use **PyPI Trusted Publishing (OIDC)**: no API token is stored in
GitHub.

| PyPI project | Source | Workflow | Tag | GitHub environment |
| --- | --- | --- | --- | --- |
| `deepagents-trace` | `python-server/` | `publish-pypi.yml` | `v<version>` | `pypi` |
| `agenttrace-langchain` (deprecated shim) | `integrations/agenttrace-langchain/` | `publish-agenttrace-langchain.yml` | `agenttrace-langchain-v<version>` | `pypi-agenttrace-langchain` |

A run fails if the tag doesn't match the package's version (`pyproject.toml`,
and `agenttrace/__init__.py` for deepagents-trace). `publish-pypi.yml` builds
the UI before the wheel and checks that the wheel ships it
(`scripts/check_wheel.py`). It also runs for a published GitHub Release whose
tag starts with `v`, and skips files already on PyPI, so a tag push followed
by a Release of the same tag publishes once.
`publish-agenttrace-langchain.yml` installs the built wheel in a clean venv,
with its dependencies from PyPI, and imports `agenttrace_langchain` before
publishing.

### Release order

`agenttrace-langchain` 0.3.0 depends on `deepagents-trace[langchain]>=0.2.0`,
so deepagents-trace is released first. Tag the commit you release (after
merging to `main`):

1. deepagents-trace 0.2.0 (the version is already 0.2.0 in both files):

   ```bash
   git tag v0.2.0 && git push origin v0.2.0
   ```

   Wait for the run to finish and for https://pypi.org/project/deepagents-trace/0.2.0/
   to exist.

2. Then the shim:

   ```bash
   git tag agenttrace-langchain-v0.3.0 && git push origin agenttrace-langchain-v0.3.0
   ```

   If deepagents-trace 0.2.0 isn't on PyPI yet, the wheel check can't install
   the dependency, so the run fails before publishing anything. Re-run it once
   step 1 is done.

For later releases, bump the version, commit, then tag. Some 0.1.x releases
were tagged `python-server-v*`; that pattern no longer publishes.

### One-time setup

Trusted publishing needs a publisher registered on PyPI and a matching GitHub
environment. The existing releases (deepagents-trace 0.1.x,
agenttrace-langchain 0.1.0 to 0.2.2) were published by these two workflows, so
both are in place for this repository; you only need this for a fork or
another PyPI account. For the shim:

1. On pypi.org, open the `agenttrace-langchain` project, then Manage →
   Publishing, and add a GitHub publisher:
   - Owner: `CouLiBaLy-B`, Repository: `agenttrace`
   - Workflow filename: `publish-agenttrace-langchain.yml`
   - Environment name: `pypi-agenttrace-langchain`

   If the project doesn't exist on PyPI yet, add the same values as a pending
   publisher (with the project name) at
   https://pypi.org/manage/account/publishing/; the first publish creates it.
2. In the GitHub repository, Settings → Environments, create
   `pypi-agenttrace-langchain`. It is separate from deepagents-trace's `pypi`
   environment, so the two packages' publish permissions stay independent.
   Optionally add a required reviewer, so each publish waits for approval.

deepagents-trace is set up the same way, with the workflow `publish-pypi.yml`
and the environment `pypi`.

## Known gaps

- Live updates are polled from the database every 0.5 s (so direct SQLite writes appear live).
- Realtime wire protocol is plain JSON over `/ws`, not the Socket.IO protocol.
