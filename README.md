# AgentTrace

> A live sequence diagram for AI engineers building autonomous and multi-agent systems. Stream LLM calls, tool calls, handoffs, and errors — then replay any run frame by frame.

Watch signals move through your agents in real time: one vertical lifeline per participant (User, Orchestrator, LLM, each Tool, each Sub-agent), each event rendering as an animated arrow in a UML-inspired sequence diagram.

## Quick start

```bash
pip install deepagents-trace
agenttrace ui                      # http://127.0.0.1:3000, SQLite by default
```

`agenttrace ui` runs a self-contained FastAPI server (SQLAlchemy + a `/ws`
live-stream) that also serves the pre-built web dashboard — **zero Node/Bun
required at runtime.** See [python-server/README.md](python-server/README.md)
for all CLI flags and the API reference.

Two separate PyPI packages back this:

- [**`deepagents-trace`**](https://pypi.org/project/deepagents-trace/) —
  the server + CLI ([`python-server/`](python-server)).
- [**`agenttrace-langchain`**](https://pypi.org/project/agenttrace-langchain/) —
  middleware to instrument a deepagents/LangChain agent
  ([`integrations/agenttrace-langchain`](integrations/agenttrace-langchain)).

## Stack

- **Backend**: FastAPI + SQLAlchemy (SQLite by default, Postgres via
  `DATABASE_URL`), signed-cookie auth, a `/ws` WebSocket for live events +
  replay. Ships as the `deepagents-trace` PyPI package/CLI.
- **Frontend**: React + Tailwind + shadcn/ui (oscilloscope / phosphor
  aesthetic), TanStack Query + Zustand, Framer Motion for the animated SVG
  diagram — built with Next.js's static export (`output: "export"`) and
  served by the FastAPI server as a plain static bundle. No Next.js server,
  no Node process, runs at all in production; `bun`/Next.js are only a
  **build-time** tool for the UI (see below).

## Developing the frontend

The UI source lives in `src/` (Next.js used purely as a static-site
generator — no API routes, no server components, no NextAuth: everything
talks to the FastAPI backend over plain `fetch`/`WebSocket`).

```bash
bun install
bun run dev              # iterate on the UI at :3000 (next dev)
```

For live data while iterating, point the UI at a separately-running
`agenttrace ui` instance (`NEXT_PUBLIC_API_BASE`/`NEXT_PUBLIC_WS_HOST` env
vars, read in `src/lib/api.ts` / `src/components/sequence-diagram/sequence-diagram.tsx`)
since `output: "export"` disables Next.js rewrites/proxying.

To rebuild the bundle embedded in the Python package:

```bash
bun run build:embed      # next build (static export) + copy into
                          # python-server/agenttrace/server/static/
```

## Instrumenting an agent

The **Integration** page (in-app) generates copy-pasteable snippets with your
project's API key pre-filled.

### Python (raw HTTP)

```python
import requests
URL = "https://your-deployment/api/events"
KEY = "atr_your_project_key"
headers = {"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}

run = requests.post(URL, json={"runId": None, "name": "my run"}, headers=headers).json()
run_id = run["runId"]
requests.post(URL, json={
    "runId": run_id, "source": "Orchestrator", "target": "LLM",
    "type": "llm_call", "label": "classify intent",
    "payload": {"result": "refund_request"}, "durationMs": 480,
}, headers=headers)
requests.post(URL, json={"runId": run_id, "endRun": "completed"}, headers=headers)
```

### DeepAgents (LangChain)

```python
# pip install agenttrace-langchain
from agenttrace_langchain import AgentTraceMiddleware
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
    # one middleware instance = one AgentTrace run
    middleware=[AgentTraceMiddleware(run_name="research — Rust frameworks")],
)

result = agent.invoke(
    {"messages": [{"role": "user", "content": "What's the state of Rust web frameworks?"}]}
)
```

Emission is non-blocking (background thread + queue, so it never adds latency
to a model/tool call) and never fatal (a misconfigured or unreachable
AgentTrace instance silently disables tracing for the run instead of breaking
the agent) — see the package
[README](integrations/agenttrace-langchain/README.md#reliability) for details,
including the `AsyncAgentTraceRun` variant for servers that cache/reuse a
compiled agent across requests.

The middleware streams, in real time:

| Event type     | Emitted from                    | Diagram arrow              |
| -------------- | -------------------------------- | ---------------------------- |
| `llm_call`     | `wrap_model_call`                | Orchestrator → LLM           |
| `tool_call`    | `wrap_tool_call` (before)         | Orchestrator → tool          |
| `tool_result`  | `wrap_tool_call` (after)          | tool → Orchestrator          |
| `handoff`      | `wrap_tool_call` (handoff tool)   | Orchestrator → Sub-agent     |
| `error`        | `wrap_tool_call` (exception)      | tool → Orchestrator (red)    |
| `final_answer` | `after_agent`                     | Orchestrator → User          |

Open the run in AgentTrace while the agent runs to watch the diagram populate
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

## CI

`.github/workflows/ci.yml` runs the two Python packages' test suites
(`python-server`, `integrations/agenttrace-langchain`) on every push and pull
request. `publish-pypi.yml` / `publish-agenttrace-langchain.yml` build and
publish each package to PyPI (Trusted Publishing/OIDC) on a matching version
tag.

## Project structure

```
python-server/                 # FastAPI backend + `agenttrace` CLI (PyPI: deepagents-trace)
  agenttrace/
    cli.py
    server/
      app.py                    # mounts /api/*, /ws, and static/ (the built UI)
      models.py, routes/, realtime.py, seed.py
      static/                   # built UI bundle (bun run build:embed), gitignored
integrations/
  agenttrace-langchain/         # AgentTraceMiddleware (PyPI: agenttrace-langchain)
src/                            # UI source (Next.js as a static-site generator only)
  app/                          # layout.tsx, page.tsx — no API routes
  components/
    sequence-diagram/           # the live SVG diagram (centerpiece) + replay
    views/                      # dashboard, projects, run, integration, settings
  lib/                          # api.ts, auth-client.tsx, store.ts, types.ts
docs/                           # functional-documentation.md, user-manual.md
```
