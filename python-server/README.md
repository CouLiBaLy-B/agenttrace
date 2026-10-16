# lanetrace (Python server + CLI)

PyPI distribution, importable module, CLI command: **`lanetrace`**; the
product is LaneTrace. Up to 0.2 it was AgentTrace, published as
`deepagents-trace` and imported as `agenttrace` (a name already taken on PyPI
by an unrelated project); see
[Upgrading from 0.2](#upgrading-from-02-renamed-to-lanetrace).

`pip install 'lanetrace[server]' && lanetrace ui` — starts the LaneTrace web
API (and a `/ws` live-stream) with **zero Node/Bun process**, `mlflow ui`-style.
For local development against this checkout: `pip install -e "./python-server[dev]"`.

The bundled dashboard has three themes (Phosphore, Cyanotype, Studio); see [Themes](https://github.com/CouLiBaLy-B/lanetrace#themes).

The package contains a FastAPI backend (`/api/*`, plus a `/ws` live stream),
the CLI, the tracking SDK, and the **bundled dashboard**: the static Next.js
export is served by the same process at `/`, so nothing else needs to run.

```bash
lanetrace demo       # seed sample projects and runs (optional: --database-url URL)
lanetrace ui         # dashboard at http://127.0.0.1:3000
```

Where the bundled UI comes from: wheels published to PyPI (and built in CI)
already contain it, because CI builds the UI before building the wheel. For a
source install (`pip install -e ./python-server`), build it yourself with
`bun install && bun run build:ui` from the repo root, which writes
`python-server/lanetrace/server/static/` (git-ignored). Without it, `/` serves
a placeholder page and the API still works.

## Quick start (MLflow-style)

```bash
pip install 'lanetrace[langchain,server]'
```

```python
import lanetrace
import lanetrace.langchain

lanetrace.set_project("support-bot")       # like mlflow.set_experiment
lanetrace.langchain.autolog()              # like mlflow.langchain.autolog
agent.invoke({"messages": [...]})          # traced into ./lanetrace.db
```

```bash
lanetrace ui                               # http://127.0.0.1:3000, reads ./lanetrace.db, no login
```

Manual tracing:

```python
with lanetrace.start_run("triage"):
    lanetrace.log_event(source="Orchestrator", target="LLM", type="llm_call", duration_ms=420)

@lanetrace.trace                           # tool_call -> tool_result | error
def web_search(query: str) -> str: ...
```

Runnable notebooks, offline (scripted models, a temporary SQLite file):
[`examples/notebooks/`](https://github.com/CouLiBaLy-B/lanetrace/tree/main/python-server/examples/notebooks)
covers autolog, the middleware and the fluent API, then the per-request async
handler below.

### Async servers (cached agent, one handler per request)

A server that compiles the agent once can't bake a per-run middleware into
it; attach a fresh async callback handler per request instead. It traces the
main agent and every deepagents sub-agent, and posts to a running
`lanetrace ui` (`LANETRACE_TRACKING_URI=http://host:port`, plus
`LANETRACE_KEY` with `--auth password`), or pass `client=`:

```python
from lanetrace.langchain import AsyncLaneTraceCallbackHandler
from lanetrace.tracking.async_http import AsyncHttpEventClient

client = AsyncHttpEventClient(url=..., api_key=..., client=httpx_async_client)  # optional
handler = AsyncLaneTraceCallbackHandler(session_id, client=client, phrases=_PHRASES, anonymizer=fn)
handler.on_user_message(query)        # then config={"callbacks": [handler]} on astream_events
handler.approval_required(info)       # HITL pause
await handler.finish(status, answer=report); await handler.aclose()
```

`anonymizer` sees every payload (dict), label (str) and the run name; if it
raises, the field is redacted, never sent unmasked. The 0.2.2 import
`from agenttrace_langchain import AgentTraceCallbackHandler, AsyncAgentTraceClient`
still works (deprecated).

| MLflow | LaneTrace |
| --- | --- |
| `mlflow.set_tracking_uri()` / `MLFLOW_TRACKING_URI` | `lanetrace.set_tracking_uri()` / `LANETRACE_TRACKING_URI` |
| `mlflow.set_experiment()` | `lanetrace.set_project()` / `LANETRACE_PROJECT` |
| `mlflow.start_run()` / `active_run()` / `end_run()` | same names |
| `@mlflow.trace` | `@lanetrace.trace` |
| `mlflow.langchain.autolog()` | `lanetrace.langchain.autolog()` |
| `MlflowClient` | `lanetrace.LaneTraceClient` |
| `mlflow ui` | `lanetrace ui` |

Tracking URIs: unset -> `sqlite:///./lanetrace.db`; any SQLAlchemy URL (e.g.
`postgresql://...`) -> written directly; `http(s)://host:port` -> sent to a
running `lanetrace ui` (set `LANETRACE_KEY` if that server uses
`--auth password`). The legacy `LANETRACE_URL` is still honored as a fallback.

`lanetrace ui --auth none` (default on localhost) needs no account or API
key; in this mode the server only accepts loopback `Host`/`Origin` headers.
When serving behind a reverse proxy, add the public hostnames with
`LANETRACE_ALLOWED_HOSTS` (comma-separated). `--auth password` (default on any
other host) keeps accounts and `atr_` project keys, and `/ws` requires a
session cookie.

To serve another database, or listen on another port/interface:

```bash
lanetrace ui --database-url postgresql://user:pass@localhost:5432/lanetrace
lanetrace ui --port 8080 --host 0.0.0.0
```

`lanetrace db init` creates the schema explicitly (also runs automatically
on `lanetrace ui` startup) — schema-push style (`Base.metadata.create_all`),
rather than migrations.

## Upgrading from 0.2 (renamed to LaneTrace)

AgentTrace is now LaneTrace: one name for the distribution, the module and
the command. Data, API keys and the HTTP API are unchanged.

- Install `lanetrace` instead of `deepagents-trace`, with the same extras:
  `pip install 'lanetrace[server]'` (also `langchain`, `postgres`, `e2e`).
- `import lanetrace` instead of `import agenttrace` (`lanetrace.langchain`,
  `lanetrace.tracking`, ... likewise), and `lanetrace ui` / `lanetrace demo`
  / `lanetrace db init` instead of `agenttrace ...`.
- Classes: `LaneTraceClient`, `LaneTraceMiddleware`,
  `LaneTraceCallbackHandler`, `AsyncLaneTraceCallbackHandler`,
  `LaneTraceRun`, `AsyncLaneTraceRun`. The `AgentTrace*` names are kept as
  deprecated aliases of the same classes, in the same modules.
- Environment variables are now `LANETRACE_*`: `LANETRACE_TRACKING_URI`,
  `LANETRACE_URL`, `LANETRACE_KEY`, `LANETRACE_PROJECT`, `LANETRACE_AUTH`,
  `LANETRACE_SECRET`, `LANETRACE_ALLOWED_HOSTS`, `LANETRACE_STATIC_DIR`, and
  for development `NEXT_PUBLIC_LANETRACE_WS_URL` / `LANETRACE_DEV_BACKEND`.
  Each `AGENTTRACE_*` name still works when the new one is unset; the first
  one used logs a deprecation line (once per process) naming its
  replacement. `DATABASE_URL` is unchanged.
- The default database is `./lanetrace.db`. When it doesn't exist but
  `./agenttrace.db` does, the SDK, `lanetrace ui` and `lanetrace demo` keep
  using `./agenttrace.db` and log once that it should be renamed: rename the
  file (`mv agenttrace.db lanetrace.db`, with the server stopped) when
  convenient.
- Existing databases need nothing: same schema, same `atr_` API keys, and
  the local (`--auth none`) user is the same.
- Password mode: the session cookie is now `lanetrace_session`, so everyone
  signs in once more after the upgrade.
- The dashboard keeps your theme and panel layout (stored in the browser
  under `agenttrace-*` keys, now `lanetrace-*`).
- Docker: the image runs `lanetrace ui`, and the compose service is
  `lanetrace` (run `docker compose up --build --remove-orphans` once).
  Compose still reads `AGENTTRACE_SECRET` if `LANETRACE_SECRET` is unset.
  Its Postgres defaults are now `lanetrace`: to keep a volume created
  before 0.3, set `POSTGRES_DB`, `POSTGRES_USER` and `POSTGRES_PASSWORD` to
  `agenttrace` in `.env`. The volume is named after the compose project (by
  default the checkout's directory), so a new clone in `lanetrace/` starts
  empty: keep the directory name or set `COMPOSE_PROJECT_NAME=agenttrace`.
- Logger names are `lanetrace.*` (were `agenttrace.*`).
- Not ready to change the code yet? `deepagents-trace` 0.3.0 is a
  compatibility package: it installs `lanetrace`, keeps `import agenttrace`
  (every submodule resolves to the `lanetrace` one) and the `agenttrace`
  command working, each with a deprecation warning. See
  [`integrations/deepagents-trace`](../integrations/deepagents-trace/README.md).
- `agenttrace-langchain` 0.4.0 depends on `lanetrace[langchain]`; its
  `agenttrace_langchain` imports are unchanged.

## Upgrading from 0.1

- The server is now the `[server]` extra: `pip install 'lanetrace[server]'`
  (the core package only carries the tracking SDK: SQLAlchemy, requests, click).
- On localhost, `lanetrace ui` now defaults to `--auth none`: no login, and
  everything is owned by a single local user, so projects created under
  existing accounts are hidden. Start it with `lanetrace ui --auth password`
  to keep using accounts and `atr_` keys.
- `agenttrace-langchain` is now a deprecation shim over `lanetrace.langchain`
  (`pip install 'lanetrace[langchain]'`); old imports keep working.
- If only `LANETRACE_KEY` is set (no `LANETRACE_TRACKING_URI`/`LANETRACE_URL`),
  traces still go to the pre-0.2 default server `http://localhost:3000`
  (a warning is logged once); set `LANETRACE_TRACKING_URI` to choose explicitly.
- The Next.js backend (Prisma, NextAuth, Socket.IO) is gone. Data from an old
  Prisma database is not migrated: start a fresh FastAPI database.
- Docker / `docker compose` users:
  - the old `web` and `socket` services are gone (one `lanetrace` service
    replaces them): run `docker compose up --build --remove-orphans` to remove
    their stale containers;
  - `NEXTAUTH_SECRET` is replaced by `LANETRACE_SECRET`, which compose now
    requires (the server refuses to start without it);
  - reusing the old `pgdata` volume keeps the orphan Prisma tables (`"User"`,
    `"Project"`, `"Run"`, `"Event"`, `"ApiKey"`, `"Account"`, `"Session"`,
    `"VerificationToken"`) next to the new `users`/`projects`/`runs`/`events`/
    `api_keys` tables: old data is not visible in the new UI. Start from a
    fresh volume (`docker compose down -v` deletes it) or drop those tables;
  - Postgres port 5432 is no longer published on the host (only the
    `lanetrace` service on 3000 is); add a `ports:` entry to `db` if you
    need host access.
- `LaneTraceRun.emit` now raises `ValueError` on an invalid event type
  instead of silently dropping the event.

## What's ported (from the pre-0.2 Next.js backend)

| Next.js (`src/`) | Python (`lanetrace/server/`) |
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
pip install -e "./python-server[dev]" -e ./integrations/deepagents-trace -e ./integrations/agenttrace-langchain
pytest python-server/tests
pytest integrations/deepagents-trace/tests integrations/agenttrace-langchain/tests   # the shims
```

End-to-end (Playwright, needs the built UI):

```bash
pip install -e "./python-server[dev,e2e]" && playwright install chromium
bun run build:ui
pytest python-server/tests_e2e
```

## Publishing

Three PyPI projects are released from this repo, each by pushing a tag. All
three workflows use **PyPI Trusted Publishing (OIDC)**: no API token is
stored in GitHub.

| PyPI project | Source | Workflow | Tag | GitHub environment |
| --- | --- | --- | --- | --- |
| `lanetrace` | `python-server/` | `publish-pypi.yml` | `v<version>` | `pypi` |
| `deepagents-trace` (deprecated shim) | `integrations/deepagents-trace/` | `publish-deepagents-trace.yml` | `deepagents-trace-v<version>` | `pypi-deepagents-trace` |
| `agenttrace-langchain` (deprecated shim) | `integrations/agenttrace-langchain/` | `publish-agenttrace-langchain.yml` | `agenttrace-langchain-v<version>` | `pypi-agenttrace-langchain` |

Each tag pattern starts one workflow only: tag filters match from the start
of the tag name, so `v*` doesn't match `deepagents-trace-v*` or
`agenttrace-langchain-v*`.

A run fails if the tag doesn't match the package's version (`pyproject.toml`,
and `lanetrace/__init__.py` for lanetrace). `publish-pypi.yml` builds
the UI before the wheel and checks that the wheel ships it
(`scripts/check_wheel.py`). It also runs for a published GitHub Release whose
tag starts with `v`, and skips files already on PyPI, so a tag push followed
by a Release of the same tag publishes once. The two shim workflows install
the built wheel in a clean venv, with its dependencies from PyPI, and import
it before publishing (`publish-deepagents-trace.yml` also runs the
`agenttrace` command).

### Release order

Both shims depend on `lanetrace` 0.3 (`deepagents-trace` 0.3.0 on
`lanetrace==0.3.*`, `agenttrace-langchain` 0.4.0 on
`lanetrace[langchain]>=0.3.0`), so lanetrace is released first. Tag the
commit you release (after merging to `main`):

1. lanetrace 0.3.0 (the version is already 0.3.0 in both files):

   ```bash
   git tag v0.3.0 && git push origin v0.3.0
   ```

   Wait for the run to finish and for https://pypi.org/project/lanetrace/0.3.0/
   to exist.

2. Then the `deepagents-trace` shim:

   ```bash
   git tag deepagents-trace-v0.3.0 && git push origin deepagents-trace-v0.3.0
   ```

3. Then the `agenttrace-langchain` shim:

   ```bash
   git tag agenttrace-langchain-v0.4.0 && git push origin agenttrace-langchain-v0.4.0
   ```

If lanetrace 0.3.0 isn't on PyPI yet, a shim's wheel check can't install
the dependency, so its run fails before publishing anything. Re-run it once
step 1 is done.

For later releases, bump the version, commit, then tag. Some 0.1.x releases
were tagged `python-server-v*`; that pattern no longer publishes.

### One-time setup

Trusted publishing needs a publisher registered on PyPI and a matching GitHub
environment. The publishers of the releases up to 0.2 were registered for
the repository under its former name, `agenttrace`; after the rename to
`CouLiBaLy-B/lanetrace` they must be added again with the new repository
name. On pypi.org, add these GitHub publishers (Owner `CouLiBaLy-B`,
Repository `lanetrace`):

| PyPI project | Where | Workflow filename | Environment name |
| --- | --- | --- | --- |
| `lanetrace` (new project) | pending publisher, https://pypi.org/manage/account/publishing/ | `publish-pypi.yml` | `pypi` |
| `deepagents-trace` | the project's Manage → Publishing | `publish-deepagents-trace.yml` | `pypi-deepagents-trace` |
| `agenttrace-langchain` | the project's Manage → Publishing | `publish-agenttrace-langchain.yml` | `pypi-agenttrace-langchain` |

A pending publisher (for a project that doesn't exist on PyPI yet) takes the
project name too; the first publish creates the project. The old publishers
(repository `agenttrace`, and `publish-pypi.yml` on `deepagents-trace`) can
then be removed.

In the GitHub repository, Settings → Environments, the environments `pypi`,
`pypi-deepagents-trace` and `pypi-agenttrace-langchain` must exist (create
`pypi-deepagents-trace`; the other two carry over with the repository). They
are separate so each package's publish permissions stay independent.
Optionally add a required reviewer, so each publish waits for approval.

## Known gaps

- Live updates are polled from the database every 0.5 s (so direct SQLite writes appear live).
- Realtime wire protocol is plain JSON over `/ws`, not the Socket.IO protocol.
