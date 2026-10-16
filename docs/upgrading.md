# Upgrading

## From 0.2 (renamed to LaneTrace)

AgentTrace is now **LaneTrace**, with one name for the PyPI distribution, the
Python module and the command: `lanetrace`. The old distribution was
`deepagents-trace`, imported as `agenttrace`, a name that belongs to another
project on PyPI. Your data, API keys and the HTTP API don't change.

| 0.2 | 0.3 |
| --- | --- |
| `pip install 'deepagents-trace[server]'` | `pip install 'lanetrace[server]'` (same extras) |
| `import agenttrace` | `import lanetrace` |
| `agenttrace ui`, `agenttrace demo`, `agenttrace db init` | `lanetrace ui`, `lanetrace demo`, `lanetrace db init` |
| `AgentTraceClient`, `AgentTraceMiddleware`, `AgentTraceCallbackHandler`, `AsyncAgentTraceCallbackHandler`, `AgentTraceRun`, `AsyncAgentTraceRun` | `LaneTraceClient`, `LaneTraceMiddleware`, `LaneTraceCallbackHandler`, `AsyncLaneTraceCallbackHandler`, `LaneTraceRun`, `AsyncLaneTraceRun` |
| `AGENTTRACE_TRACKING_URI`, `AGENTTRACE_URL`, `AGENTTRACE_KEY`, `AGENTTRACE_PROJECT` | `LANETRACE_TRACKING_URI`, `LANETRACE_URL`, `LANETRACE_KEY`, `LANETRACE_PROJECT` |
| `AGENTTRACE_AUTH`, `AGENTTRACE_SECRET`, `AGENTTRACE_ALLOWED_HOSTS`, `AGENTTRACE_STATIC_DIR` | `LANETRACE_AUTH`, `LANETRACE_SECRET`, `LANETRACE_ALLOWED_HOSTS`, `LANETRACE_STATIC_DIR` |
| `NEXT_PUBLIC_AGENTTRACE_WS_URL`, `AGENTTRACE_DEV_BACKEND` (UI development) | `NEXT_PUBLIC_LANETRACE_WS_URL`, `LANETRACE_DEV_BACKEND` |
| `./agenttrace.db` | `./lanetrace.db` |

What keeps working while you migrate:

- **Old class names.** The `AgentTrace*` classes are deprecated aliases of
  the `LaneTrace*` ones, in the same modules.
- **Old environment variables.** Each `AGENTTRACE_*` name is read when its
  `LANETRACE_*` name is unset (the new one wins). The first one used logs a
  deprecation line, once per process, naming the variable to set instead.
  `DATABASE_URL` keeps its name.
- **Old database file.** When `./lanetrace.db` doesn't exist but
  `./agenttrace.db` does, the SDK, `lanetrace ui` and `lanetrace demo` use
  `./agenttrace.db` and log once that it should be renamed. Rename it
  (`mv agenttrace.db lanetrace.db`, with the server stopped) when convenient.
  The schema, the `atr_` API keys and the local user of `--auth none` are
  unchanged, so any existing database works as it is.
- **Old code, unchanged.** `deepagents-trace` 0.3.0 is a compatibility
  package: it installs `lanetrace` and keeps `import agenttrace`, every
  `agenttrace.<submodule>` (they resolve to the `lanetrace` modules) and the
  `agenttrace` command working, each with a deprecation warning. Its extras
  (`server`, `langchain`, `postgres`, ...) install the same `lanetrace`
  extras.
- **The dashboard** keeps the theme and panel layout stored in your browser.

What changes:

- **Logger names** are `lanetrace.*` instead of `agenttrace.*`: update
  logging configuration that filters or routes them (for example
  `logging.getLogger("lanetrace").setLevel(...)`).
- **Password mode signs everyone out once**: the session cookie is now
  `lanetrace_session`.
- **Docker.** The image runs `lanetrace ui` and the compose service is
  `lanetrace`: run `docker compose up --build --remove-orphans` once.
  Compose still reads `AGENTTRACE_SECRET` when `LANETRACE_SECRET` is unset.
  Its Postgres defaults are now `lanetrace`; to keep a volume created before
  0.3, set `POSTGRES_DB`, `POSTGRES_USER` and `POSTGRES_PASSWORD` to
  `agenttrace` in `.env`. The volume itself is named after the compose
  project, which defaults to the checkout's directory name
  (`agenttrace_pgdata` for a checkout in `agenttrace/`): a new clone in
  `lanetrace/` starts with an empty database. Keep the directory name, or set
  `COMPOSE_PROJECT_NAME=agenttrace` in `.env`.
- **Password mode under compose** refuses to start without
  `LANETRACE_SECRET` (or `AGENTTRACE_SECRET`): compose sets
  `LANETRACE_REQUIRE_SECRET=1`.
- **`agenttrace-langchain` 0.4.0** depends on `lanetrace[langchain]>=0.3.0`;
  its `agenttrace_langchain` imports are unchanged.

## From deepagents-trace 0.1

The full list is in the
[python-server README](https://github.com/CouLiBaLy-B/lanetrace/blob/main/python-server/README.md#upgrading-from-01);
in short (with the 0.3 names):

- The server is now the `server` extra: `pip install 'lanetrace[server]'`.
  The package alone only carries the SDK (SQLAlchemy, requests, click).
- On localhost, `lanetrace ui` now defaults to `--auth none`: no login, and
  everything belongs to a single local user, so the projects of existing
  accounts don't show. Start it with `--auth password` to keep using accounts
  and `atr_` keys.
- When only `LANETRACE_KEY` is set, without `LANETRACE_TRACKING_URI` or
  `LANETRACE_URL`, traces still go to the pre-0.2 default server,
  `http://localhost:3000`, with a warning logged once. Set
  `LANETRACE_TRACKING_URI` to choose.
- The Next.js backend (Prisma, NextAuth, Socket.IO) is gone, and data from its
  database is not migrated: start from a new database.
- With Docker Compose, one `lanetrace` service replaces `web` and `socket`
  (run `docker compose up --build --remove-orphans`), `LANETRACE_SECRET`
  replaces `NEXTAUTH_SECRET` and is required, and PostgreSQL is no longer
  published on the host.
- `LaneTraceRun.emit` raises a `ValueError` for an unknown event type instead
  of dropping the event.

## From agenttrace-langchain 0.2.x

`agenttrace-langchain` is a deprecated shim (0.3.0 on top of
`deepagents-trace[langchain]`, 0.4.0 on top of `lanetrace[langchain]>=0.3.0`):
it re-exports the old names, which emit a `DeprecationWarning`, as do the old
submodules (`agenttrace_langchain.client`, `.async_client`, `.run`,
`.async_run`, `.middleware`, `.callback`, `.projection`). Move to the new
imports:

| `agenttrace_langchain` | New import |
| --- | --- |
| `AgentTraceMiddleware` | `lanetrace.langchain.LaneTraceMiddleware` |
| `AgentTraceCallbackHandler` (0.2.2, async) | `lanetrace.langchain.AsyncLaneTraceCallbackHandler` |
| `AgentTraceClient` | `lanetrace.tracking.http.HttpEventClient` |
| `AgentTraceRun` | `lanetrace.tracking.http.LaneTraceRun` |
| `AsyncAgentTraceClient` | `lanetrace.tracking.async_http.AsyncHttpEventClient`, also `lanetrace.langchain.AsyncHttpEventClient` |
| `AsyncAgentTraceRun` | `lanetrace.tracking.async_run.AsyncLaneTraceRun` |

`lanetrace.langchain.LaneTraceCallbackHandler`, without `Async`, is a
different class: the sync handler that `autolog()` installs.

What behaves differently (see the
[shim README](https://github.com/CouLiBaLy-B/lanetrace/blob/main/integrations/agenttrace-langchain/README.md#upgrading-from-02x)):

- **No API key no longer means no tracing.** An async client without a key
  (`api_key=None` and no `LANETRACE_KEY`) now posts without an
  `Authorization` header, for a local `lanetrace ui --auth none`; a server
  that wants a key answers 401 and the run turns off, with one warning. A
  `LaneTraceMiddleware()` without `url` or `api_key` now writes to the
  [tracking URI](mlflow.md#tracking-uris): `./lanetrace.db`, unless
  `LANETRACE_TRACKING_URI`, `LANETRACE_URL` or `LANETRACE_KEY` points at a
  server. If a missing key was your off switch, decide in your app whether to
  attach tracing.
- **The anonymizer also receives strings.** It is called with every payload (a
  JSON-safe dict), every label (a string) and the run name, and must handle
  both. If it raises, or returns something other than a string for a label,
  the field is redacted instead of sent unmasked. See
  [Anonymizer](integration-callback.md#anonymizer).
- **Stricter hand-offs in the async handler.** For
  `AsyncLaneTraceCallbackHandler`, only a tool named exactly `task`, or one
  whose name contains `handoff` or `delegate`, is a hand-off to a sub-agent:
  `create_task`, for example, is now a plain tool call. (The middleware never
  counted `task` as a hand-off.)
