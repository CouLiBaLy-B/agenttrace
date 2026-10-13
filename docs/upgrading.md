# Upgrading

## From deepagents-trace 0.1

The full list is in the
[python-server README](https://github.com/CouLiBaLy-B/agenttrace/blob/main/python-server/README.md#upgrading-from-01);
in short:

- The server is now the `server` extra: `pip install 'deepagents-trace[server]'`.
  The package alone only carries the SDK (SQLAlchemy, requests, click).
- On localhost, `agenttrace ui` now defaults to `--auth none`: no login, and
  everything belongs to a single local user, so the projects of existing
  accounts don't show. Start it with `--auth password` to keep using accounts
  and `atr_` keys.
- When only `AGENTTRACE_KEY` is set, without `AGENTTRACE_TRACKING_URI` or
  `AGENTTRACE_URL`, traces still go to the pre-0.2 default server,
  `http://localhost:3000`, with a warning logged once. Set
  `AGENTTRACE_TRACKING_URI` to choose.
- The Next.js backend (Prisma, NextAuth, Socket.IO) is gone, and data from its
  database is not migrated: start from a new database.
- With Docker Compose, one `agenttrace` service replaces `web` and `socket`
  (run `docker compose up --build --remove-orphans`), `AGENTTRACE_SECRET`
  replaces `NEXTAUTH_SECRET` and is required, and PostgreSQL is no longer
  published on the host.
- `AgentTraceRun.emit` raises a `ValueError` for an unknown event type instead
  of dropping the event.

## From agenttrace-langchain 0.2.x

`agenttrace-langchain` 0.3.0 is a deprecated shim: it depends on
`deepagents-trace[langchain]>=0.2.0` and re-exports the old names, which emit a
`DeprecationWarning`, as do the old submodules (`agenttrace_langchain.client`,
`.async_client`, `.run`, `.async_run`, `.middleware`, `.callback`,
`.projection`). Move to the new imports:

| `agenttrace_langchain` | New import |
| --- | --- |
| `AgentTraceMiddleware` | `agenttrace.langchain.AgentTraceMiddleware` |
| `AgentTraceCallbackHandler` (0.2.2, async) | `agenttrace.langchain.AsyncAgentTraceCallbackHandler` |
| `AgentTraceClient` | `agenttrace.tracking.http.HttpEventClient` |
| `AgentTraceRun` | `agenttrace.tracking.http.AgentTraceRun` |
| `AsyncAgentTraceClient` | `agenttrace.tracking.async_http.AsyncHttpEventClient`, also `agenttrace.langchain.AsyncHttpEventClient` |
| `AsyncAgentTraceRun` | `agenttrace.tracking.async_run.AsyncAgentTraceRun` |

`agenttrace.langchain.AgentTraceCallbackHandler`, without `Async`, is a
different class: the sync handler that `autolog()` installs.

What behaves differently (see the
[shim README](https://github.com/CouLiBaLy-B/agenttrace/blob/main/integrations/agenttrace-langchain/README.md#upgrading-from-02x)):

- **No API key no longer means no tracing.** An async client without a key
  (`api_key=None` and no `AGENTTRACE_KEY`) now posts without an
  `Authorization` header, for a local `agenttrace ui --auth none`; a server
  that wants a key answers 401 and the run turns off, with one warning. An
  `AgentTraceMiddleware()` without `url` or `api_key` now writes to the
  [tracking URI](mlflow.md#tracking-uris): `./agenttrace.db`, unless
  `AGENTTRACE_TRACKING_URI`, `AGENTTRACE_URL` or `AGENTTRACE_KEY` points at a
  server. If a missing key was your off switch, decide in your app whether to
  attach tracing.
- **The anonymizer also receives strings.** It is called with every payload (a
  JSON-safe dict), every label (a string) and the run name, and must handle
  both. If it raises, or returns something other than a string for a label,
  the field is redacted instead of sent unmasked. See
  [Anonymizer](integration-callback.md#anonymizer).
- **Stricter hand-offs in the async handler.** For
  `AsyncAgentTraceCallbackHandler`, only a tool named exactly `task`, or one
  whose name contains `handoff` or `delegate`, is a hand-off to a sub-agent:
  `create_task`, for example, is now a plain tool call. (The middleware never
  counted `task` as a hand-off.)
