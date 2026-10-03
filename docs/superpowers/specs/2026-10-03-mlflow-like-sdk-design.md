# MLflow-like SDK — design

Date: 2026-10-03
Status: approved in conversation, pending written review
Scope: sub-projects **A** (single package + fluent API), **B** (keyless local
mode), **C** (LangChain autolog). Sub-project **D** (bundled UI in the pip
package) gets its own spec later.

## Goal

Make `deepagents-trace` feel like MLflow: one package, a fluent module-level
API, zero-config local storage, and one-line autologging.

Success criterion — after `pip install deepagents-trace[langchain]`, with no
API key and no server running:

```python
import agenttrace
import agenttrace.langchain

agenttrace.set_project("support-bot")
agenttrace.langchain.autolog()
agent.invoke({"messages": [...]})
```

writes a run to `./agenttrace.db`, and `agenttrace ui` (started before or
after) shows it — live if the UI is open while the agent runs.

## Constraints

- The `POST /api/events` contract stays backward compatible: existing
  `atr_` key clients keep working unchanged.
- The existing `agenttrace-langchain` package keeps working through a
  re-export shim (`DeprecationWarning`), so current users aren't broken.
- Tracing is **non-blocking** and **never fatal** in every store (same
  contract as today's `AgentTraceRun`).
- Live diagram updates must work even when the client writes to SQLite
  directly (no server in the write path).

## Approach

MLflow-style **tracking store abstraction**. The tracking URI selects a
store:

| URI | Store |
| --- | --- |
| unset (default) | `SqlStore` on `sqlite:///./agenttrace.db` |
| `sqlite:///…`, `postgresql://…`, any SQLAlchemy URL | `SqlStore` |
| `http://…`, `https://…` | `RestStore` (`POST <uri>/api/events`) |

Resolution order: `set_tracking_uri()` argument > `AGENTTRACE_TRACKING_URI`
env var > default. For backward compatibility, `AGENTTRACE_URL` (the full
`/api/events` URL used by today's client) is accepted as a fallback for the
HTTP case, with its `/api/events` suffix stripped.

Rejected alternatives: spawning a background server from the client
(fragile: ports, orphan processes); JSONL files imported by the UI (second
format to maintain, no live view).

## Package layout

`python-server/` remains the root of the `deepagents-trace` distribution.

```text
agenttrace/
  __init__.py            # public fluent API (see below) + AgentTraceClient
  store/                 # shared by client and server
    models.py            # moved from server/models.py
    db.py                # engine/session factory, parameterised by URL
  tracking/
    _uri.py              # tracking URI resolution
    stores/base.py       # TrackingStore ABC
    stores/sql.py        # SqlStore
    stores/rest.py       # RestStore
    run.py               # ActiveRun: queue + background worker
    fluent.py            # global state, active-run stack
    client.py            # AgentTraceClient (explicit API, like MlflowClient)
  langchain/
    __init__.py          # autolog, AgentTraceMiddleware, AgentTraceCallbackHandler
    callback.py          # AgentTraceCallbackHandler
    middleware.py        # moved from integrations/agenttrace-langchain
  server/                # FastAPI app; server/models.py and server/db.py
                         # become thin re-exports of agenttrace.store.*
  cli.py
```

`agenttrace.store.db` replaces the module-level engine with a cached
`get_engine(url)` / `get_sessionmaker(url)` so the client can target any URL
while the server keeps using `DATABASE_URL`. `init_db(url)` runs
`create_all` (schema-push, unchanged policy).

### Dependencies

- core: `sqlalchemy>=2.0`, `requests>=2.31`, `click>=8.1`
- `[server]`: `fastapi`, `uvicorn[standard]`, `bcrypt`, `itsdangerous`,
  `websockets`
- `[langchain]`: `langchain>=1.0.0`, `langchain-core`
- `[dev]`: `pytest`, `pytest-asyncio`, `httpx`, plus the server and
  langchain extras

`agenttrace ui` without the `[server]` extra exits with a clear message:
`pip install 'deepagents-trace[server]'`.

`integrations/agenttrace-langchain` becomes a shim: depends on
`deepagents-trace[langchain]`, re-exports `AgentTraceMiddleware`,
`AgentTraceClient`, `AgentTraceRun`, `AsyncAgentTraceClient`,
`AsyncAgentTraceRun` from their new homes and emits a `DeprecationWarning`
on import. The async client/run classes move to `agenttrace.tracking`
unchanged.

## Tracking stores

```python
class TrackingStore(ABC):
    def create_run(self, project: str, name: str) -> str: ...
    def log_event(self, run_id: str, event: dict) -> None: ...
    def end_run(self, run_id: str, status: str) -> None: ...  # completed | failed
```

`event` uses the wire field names of `/api/events` (`source`, `target`,
`type`, `label`, `payload`, `durationMs`, `status`). Validation of `type`
(the six event types) happens once, in `ActiveRun.log_event`, raising
`ValueError` synchronously — a programming error, not a runtime failure.

**SqlStore** — calls `init_db(url)` on first use. `create_run` looks up the
project by name owned by the `local` user (`email = "local@agenttrace"`,
no password), creating user and project if missing. `log_event` assigns
`seq = count(events for run)` inside the same transaction, mirroring the
server route. Event creation logic (seq, default status, payload JSON
encoding) is extracted into `agenttrace/store/events.py` and shared with
`server/routes/events.py` so both write paths stay identical.

**RestStore** — `create_run` posts `{"runId": null, "name", "project"}`;
sends `Authorization: Bearer <AGENTTRACE_KEY>` when the key is set. When a
key is set, the server ignores `project` (the key determines the project).

## ActiveRun (non-blocking, never fatal)

Generalises today's `AgentTraceRun` over a `TrackingStore`:

- `log_event()` / `end()` enqueue; one daemon worker thread per run drains
  FIFO (preserves `seq` ordering). The remote run is created lazily by the
  worker on the first item.
- First store exception: one `logging.warning`, run permanently disabled,
  caller unaffected.
- `close(timeout=10)` drains with a bound. An `atexit` hook closes all
  still-open runs (marking them `completed`) so short scripts don't lose
  events.
- `ActiveRun.run_id` blocks (bounded by `timeout`) until the worker has
  created the run, returning `None` if creation failed.
- `truncate` / `compact` helpers and the existing size limits are kept.

## Fluent API (`agenttrace/__init__.py`)

```python
set_tracking_uri(uri: str | None) -> None
get_tracking_uri() -> str
set_project(name: str) -> None          # default project: "Default"
start_run(name: str | None = None, *, project: str | None = None) -> ActiveRun
active_run() -> ActiveRun | None
end_run(status: str = "completed") -> None
log_event(*, source, target, type, label=None, payload=None,
          duration_ms=None, status=None) -> None
trace(fn=None, *, target: str | None = None, source: str = "Orchestrator")
AgentTraceClient
```

- The active-run stack lives in a `contextvars.ContextVar` (immutable tuple),
  so threads and asyncio tasks each see the correct current run.
- `start_run()` returns an `ActiveRun` usable as a context manager; leaving
  the block ends it `completed`, or `failed` if an exception propagates (the
  exception is re-raised). Nested `start_run()` creates a separate run.
  Default name: `"run <YYYY-MM-DD HH:MM:SS>"`.
- `log_event()` with no active run starts one implicitly (MLflow behaviour);
  that run is ended at interpreter exit by the `atexit` hook.
- `@trace` (bare or with args) wraps sync and async functions: emits
  `tool_call` (`source → target`, label `fn(args…)`, payload `{"args",
  "kwargs"}` compacted) before the call, then `tool_result` with
  `durationMs` and the compacted return value, or `error` with the exception
  message and re-raises. `target` defaults to the function's `__name__`.
  Without an active run, it starts an implicit one like `log_event`.

`AgentTraceClient(tracking_uri=None)` exposes the same operations explicitly
and synchronously (`create_run`, `log_event`, `end_run`) — fail-loud, like
today's client and like `MlflowClient`.

## Keyless local mode (server)

New `agenttrace ui --auth [none|password]` option:

- Default: `none` when `--host` is `127.0.0.1`/`localhost`, `password`
  otherwise. `--auth none` with a non-loopback host prints a warning but is
  allowed (explicit choice).
- Stored in `AGENTTRACE_AUTH` so the app reads it at startup.

With `auth=none`:

- `POST /api/events` without a Bearer header requires a `project` field when
  creating a run (400 otherwise) and finds-or-creates that project for the
  `local` user. For appending/ending, the run id alone identifies the run.
  A provided `atr_` key is still validated and takes precedence.
- `require_user` returns the `local` user (created on demand) instead of
  checking the session cookie, so all dashboard routes work without login.

With `auth=password`: behaviour is exactly today's.

## Live updates with direct SQLite writes

`realtime.py` gains a polling task, started on app startup: every 500 ms,
for each run that has at least one WebSocket subscriber, select events with
`seq > last_seen_seq[run_id]` and broadcast them, plus a `run:update` when
the run's status/`ended_at` changed. `last_seen_seq` is initialised at
subscribe time. To avoid double delivery, the REST route no longer
broadcasts directly; the poller is the single broadcast path for both
write paths. (Latency ≤ 500 ms, acceptable for a sequence diagram.)

## LangChain autolog

`agenttrace.langchain.autolog(disable: bool = False)`:

- Registers a module-level `ContextVar[AgentTraceCallbackHandler | None]`
  with `langchain_core.tracers.context.register_configure_hook(var,
  inheritable=True)` once, and sets the var to a handler instance (or
  `None` on `disable=True`). Calling it twice is idempotent.
- The handler is also usable directly:
  `agent.invoke(..., config={"callbacks": [AgentTraceCallbackHandler()]})`.

`AgentTraceCallbackHandler` mapping:

| Callback | Event |
| --- | --- |
| `on_chain_start` with `parent_run_id is None` | open run (name = chain name), unless a fluent run is already active — then reuse it and don't close it |
| `on_chat_model_start` / `on_llm_start` + `on_llm_end` | `llm_call` Orchestrator → LLM, with duration, model name and token usage when available |
| `on_tool_start` | `tool_call` Orchestrator → tool name (`handoff` → sub-agent if the name contains `handoff`/`delegate` — the middleware's `_HANDOFF_MARKERS`, shared) |
| `on_tool_end` | `tool_result` tool → Orchestrator, with duration |
| `on_tool_error` / `on_llm_error` | `error` (status `error`) |
| `on_chain_end` with `parent_run_id is None` | `final_answer` Orchestrator → User (last message text), end run `completed` |
| `on_chain_error` with `parent_run_id is None` | end run `failed` |

LangChain run ids (UUIDs) map to AgentTrace runs and start timestamps in a
dict keyed by the root `run_id`, so concurrent invocations don't mix.
Handler methods never raise.

## Error handling summary

| Situation | Behaviour |
| --- | --- |
| Invalid event `type` | `ValueError` at call site |
| Store unreachable / DB error | one warning, run disabled, agent continues |
| `RestStore` without key against `auth=password` server | 401 → same as above, warning mentions `AGENTTRACE_KEY` |
| `agenttrace ui` without `[server]` extra | exit 1 with install hint |
| `AgentTraceClient` errors | raised (fail-loud by design) |

## Testing

- `SqlStore`: SQLite in a tmp dir — project/user auto-creation, seq
  ordering, end_run.
- `RestStore`: against the FastAPI `TestClient` (via an injectable
  `requests`-compatible session) — keyed and keyless (`auth=none`) flows.
- `ActiveRun`: ordering, never-fatal on store failure, `atexit` close,
  `run_id` blocking.
- Fluent API: context manager status, nesting, implicit run, isolation
  across threads and asyncio tasks, `@trace` on sync/async/raising
  functions, URI resolution order including `AGENTTRACE_URL` fallback.
- Server: `auth=none` ingestion and dashboard access, `auth=password`
  unchanged (existing tests), poller broadcasts events written directly
  to the DB.
- Autolog: fake chat model + tool via `langchain_core` fakes, invoked with
  autolog enabled — expected event sequence; `disable=True` emits nothing;
  reuse of an active fluent run.
- Migration: existing tests of both packages moved and passing; shim
  import emits `DeprecationWarning`.
- CI: add a Python job running `pytest python-server/tests`.

## Out of scope

- Bundled frontend in the pip package (sub-project D).
- Alembic migrations.
- Autolog for other frameworks (OpenAI SDK, etc.).
- Publishing to PyPI (the existing release workflow is reused unchanged).
