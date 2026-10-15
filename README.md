# LaneTrace

> A live sequence diagram for AI engineers building autonomous and multi-agent systems. Stream LLM calls, tool calls, handoffs, and errors — then replay any run frame by frame.

Watch signals move through your agents in real time: one vertical lifeline per participant (User, Orchestrator, LLM, each Tool, each Sub-agent), each event rendering as an animated arrow in a UML-inspired sequence diagram.

**Documentation:** [coulibaly-b.github.io/lanetrace](https://coulibaly-b.github.io/lanetrace/)

> Formerly **AgentTrace** (`pip install deepagents-trace`, `import agenttrace`). Since 0.3 the
> distribution, the module and the command are all `lanetrace`; old code and environment variables
> keep working for now. See [Upgrading from 0.2](https://coulibaly-b.github.io/lanetrace/upgrading/#from-02-renamed-to-lanetrace).

![Run view in the Phosphore theme](docs/screenshots/run-phosphore.png)

## Themes

LaneTrace ships three themes, each with its own palette, typography and motion.

| Phosphore | Cyanotype | Studio |
| --- | --- | --- |
| <img src="docs/screenshots/run-phosphore.png" alt="Run view, Phosphore theme" width="320"> | <img src="docs/screenshots/run-cyanotype.png" alt="Run view, Cyanotype theme" width="320"> | <img src="docs/screenshots/run-studio.png" alt="Run view, Studio theme" width="320"> |
| Dark oscilloscope: phosphor-green glow, mono labels, arrows that draw like a beam. | Dark blueprint: drafting-table blues, technical type, arrows that plot in crisply. | Light and calm: paper surfaces, soft shadows, arrows that settle with a spring. |

Switch themes with the swatches at the bottom of the sidebar, or in Settings →
Theme. **Auto** (the default) follows your OS: dark picks Cyanotype, light picks
Studio. Your choice is remembered in the browser. All motion respects
`prefers-reduced-motion`: animations shrink to a short fade with no travel.

## Stack

- **FastAPI** backend, shipped in the `lanetrace` Python package (SQLAlchemy; SQLite by default, Postgres optional), with a plain-JSON `/ws` live stream
- **Next.js 16** (TypeScript, static export) — a build tool only: the exported UI is bundled into the Python package and served by FastAPI, so no Node/Bun runtime is needed to run LaneTrace
- **Tailwind CSS 4** + **shadcn/ui** (oscilloscope / phosphor aesthetic)
- **TanStack Query** + **Zustand** for server/client state
- **Framer Motion** for the animated SVG diagram

## Quick start

```bash
pip install 'lanetrace[server]'
lanetrace demo           # seed sample projects and runs into ./lanetrace.db
lanetrace ui             # open http://127.0.0.1:3000
```

`lanetrace demo [--database-url URL]` seeds three sample projects (Customer
Support Agent, Research Assistant, Code Review Bot) for the local (no-auth)
user that `lanetrace ui` uses on loopback. In password mode, signed-in users
load them from Settings → Demo data → "Load demo projects". `lanetrace ui [--host H]
[--port P] [--auth none|password] [--database-url URL]` serves the dashboard on
`http://127.0.0.1:3000` by default; auth is `none` on loopback (no login) and
`password` on any other host. For the MLflow-style local flow
(`lanetrace.langchain.autolog()` writing to `./lanetrace.db`) see the
[python-server README](python-server/README.md#quick-start-mlflow-style).

### Configuration

| Variable | Used by | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | server | Database to serve (default: local `./lanetrace.db`) |
| `LANETRACE_SECRET` | server | Session-signing secret for password mode. If unset, a random per-process secret is used and sessions reset on restart |
| `LANETRACE_AUTH` | server | `none` or `password` — default for `lanetrace ui --auth` (an explicit `--auth` wins; neither: `none` on loopback, `password` otherwise) |
| `LANETRACE_ALLOWED_HOSTS` | server | Comma-separated extra hostnames accepted in `--auth none` mode (e.g. behind a reverse proxy) |
| `LANETRACE_TRACKING_URI` | SDK | Where traces go (local DB, SQLAlchemy URL, or `http(s)://` server) |
| `LANETRACE_PROJECT` | SDK | Default project name |
| `LANETRACE_KEY` | SDK | `atr_` project key for a password-mode server |

Package extras: `server`, `langchain`, `postgres`, `e2e`, `dev`.

## Docker

A single image: a Bun stage builds the UI, then `python:3.12-slim` runs
`lanetrace ui --host 0.0.0.0` as a non-root user (uid 10001, `WORKDIR /data`).

```bash
# Postgres + lanetrace, password auth (LANETRACE_SECRET is required)
LANETRACE_SECRET=$(openssl rand -base64 32) docker compose up --build

# Or build and run the image directly (SQLite in /data; keep it in a volume)
docker build -t lanetrace .
docker run -p 3000:3000 -e LANETRACE_SECRET=$(openssl rand -base64 32) \
  -v lanetrace-data:/data lanetrace
```

`docker-compose.yml` runs Postgres alongside the `lanetrace` service, which
connects with `DATABASE_URL=postgresql+psycopg://...`. Compose refuses to start
unless `LANETRACE_SECRET` is set (put it in `.env`, see `.env.example`). With
bare `docker run` and no `DATABASE_URL`, the server uses SQLite at
`/data/lanetrace.db`: mount a volume on `/data` (as above) or the data is lost
with the container; without `LANETRACE_SECRET` a random secret is used and
sign-ins reset on every restart.

The image runs in password mode, so sign up in the browser and load sample
projects from Settings → Demo data → "Load demo projects".
`lanetrace demo` only seeds the local (no-auth) user and has no visible
effect on a password-mode server.

## Development

Backend:

```bash
pip install -e "./python-server[dev]"    # or: uv pip install -e "./python-server[dev]"
lanetrace ui --auth none                 # API + /ws on :3000
pytest python-server/tests
```

UI (hot reload):

```bash
bun install
NEXT_PUBLIC_LANETRACE_WS_URL=ws://localhost:3000/ws bun run dev    # http://localhost:3001
```

REST calls from the dev server are proxied to `:3000` by Next rewrites
(override with `LANETRACE_DEV_BACKEND`). `bun run build:ui` rebuilds the static
export and refreshes `python-server/lanetrace/server/static/` (git-ignored);
run it before testing the bundled UI from a source install. Also:
`bun run lint`, `bun run typecheck`.

End-to-end tests (Playwright, against the bundled UI):

```bash
pip install -e "./python-server[dev,e2e]" && playwright install chromium
bun run build:ui
pytest python-server/tests_e2e
```

## CI

`.github/workflows/ci.yml` runs on every push and pull request:

1. **ui** — lint, typecheck and build the static export, uploaded as an artifact
2. **python** (needs ui) — unit tests, builds the wheel with the UI bundled and checks it
3. **e2e** (needs ui) — Playwright tests against the bundled dashboard
4. **docker** — builds the image and smoke-tests it

`publish-pypi.yml` builds the UI before the wheel and runs
`python-server/scripts/check_wheel.py` to make sure the bundle ships. The
deprecated `deepagents-trace` and `agenttrace-langchain` shims have their own
publish workflows (see the
[python-server README](python-server/README.md#publishing)).

## Instrumenting an agent

The **Integration** page (in-app) generates copy-pasteable snippets. Three
ways to emit events:

### Python SDK

```bash
pip install lanetrace
```

```python
import lanetrace

lanetrace.set_project("support-bot")
with lanetrace.start_run("triage"):
    lanetrace.log_event(source="Orchestrator", target="LLM",
                         type="llm_call", label="classify intent", duration_ms=480)

@lanetrace.trace                       # tool_call -> tool_result | error
def web_search(query: str) -> str: ...
```

Where traces go is controlled by `LANETRACE_TRACKING_URI` (unset: local
`./lanetrace.db`; `http(s)://host:port`: a running `lanetrace ui`, with
`LANETRACE_KEY` if it uses password auth). `LANETRACE_PROJECT` selects the
project. See [python-server/README.md](python-server/README.md).

### Raw HTTP / other languages
See the [event ingestion API](#event-ingestion-api) below; the Integration page
in the app generates snippets with your project's key pre-filled.

### DeepAgents (LangChain)

The DeepAgents snippet provides a drop-in `AgentMiddleware` (deepagents' current
middleware system — `before_agent` / `wrap_model_call` / `wrap_tool_call` /
`after_agent`) that instruments a `create_deep_agent` run. It's also published
as part of `lanetrace` (`lanetrace.langchain`); the old
[`integrations/agenttrace-langchain`](integrations/agenttrace-langchain) package is a deprecated shim.
Attach one instance per agent:

```python
# pip install 'lanetrace[langchain]'
from lanetrace.langchain import LaneTraceMiddleware
from deepagents import create_deep_agent
from langchain_openai import ChatOpenAI
from langchain_core.tools import tool

@tool
def web_search(query: str) -> str:
    """Search the web."""
    return "..."

agent = create_deep_agent(
    model=ChatOpenAI(model="gpt-4o-mini"),
    tools=[web_search],
    # one middleware instance = one LaneTrace run
    middleware=[LaneTraceMiddleware(run_name="research — Rust frameworks")],
)

result = agent.invoke(
    {"messages": [{"role": "user", "content": "What's the state of Rust web frameworks?"}]}
)
```

Emission is non-blocking (background thread + queue, so it never adds latency
to a model/tool call) and never fatal (a misconfigured or unreachable
LaneTrace instance silently disables tracing for the run instead of breaking
the agent) — see the package
[README](integrations/agenttrace-langchain/README.md#reliability) for details.

Or skip the middleware entirely: `lanetrace.langchain.autolog()`.

The middleware streams, in real time:

| Event type     | Emitted from                    | Diagram arrow              |
| -------------- | -------------------------------- | ---------------------------- |
| `llm_call`     | `wrap_model_call`                | Orchestrator → LLM           |
| `tool_call`    | `wrap_tool_call` (before)         | Orchestrator → tool          |
| `tool_result`  | `wrap_tool_call` (after)          | tool → Orchestrator          |
| `handoff`      | `wrap_tool_call` (handoff tool)   | Orchestrator → Sub-agent     |
| `error`        | `wrap_tool_call` (exception)      | tool → Orchestrator (red)    |
| `final_answer` | `after_agent`                     | Orchestrator → User          |

Open the run in LaneTrace while the agent runs to watch the diagram populate
live, or replay it afterward at 0.5× / 1× / 2× / instant.

## Event ingestion API

`POST /api/events` — authenticate with `Authorization: Bearer atr_<key>`.

```jsonc
{
  "runId": "run_abc123",        // null/omit to create a new run
  "source": "Orchestrator",
  "target": "web_search",
  "type": "tool_call",          // llm_call | tool_call | tool_result | handoff | error | final_answer
  "label": "web_search(query)",
  "payload": { "args": { "query": "..." } },
  "durationMs": 720,
  "status": "ok",               // ok | error | pending
  "endRun": "completed"         // optional: "completed" | "failed" to close the run
}
```

## Project structure

```
src/                      # Next.js UI source (static export; build tool only)
  app/                    # App Router pages
  components/
    sequence-diagram/     # the live SVG diagram (centerpiece) + replay
    views/                # dashboard, projects, run, integration, settings
    layout/               # sidebar, footer
    auth/                 # auth screen
  lib/                    # api client, store, types, websocket client
scripts/copy-ui.mjs       # copies the export into the Python package
python-server/            # the `lanetrace` package (import `lanetrace`)
  lanetrace/server/       # FastAPI app, routes, realtime /ws, bundled static/
  lanetrace/tracking/     # SDK (set_project, start_run, trace, ...)
  lanetrace/langchain/    # DeepAgents middleware + autolog
  tests/  tests_e2e/      # pytest and Playwright suites
integrations/             # deprecated shims: deepagents-trace (import agenttrace), agenttrace-langchain
Dockerfile                # bun UI build + python:3.12-slim runtime
docker-compose.yml        # Postgres + lanetrace
.github/workflows/        # ci.yml, docs.yml, publish-*.yml
```
