# AgentTrace

> A live sequence diagram for AI engineers building autonomous and multi-agent systems. Stream LLM calls, tool calls, handoffs, and errors — then replay any run frame by frame.

Watch signals move through your agents in real time: one vertical lifeline per participant (User, Orchestrator, LLM, each Tool, each Sub-agent), each event rendering as an animated arrow in a UML-inspired sequence diagram.

## Stack

- **Next.js 16** (App Router, TypeScript) — `output: standalone` for Docker
- **Tailwind CSS 4** + **shadcn/ui** (oscilloscope / phosphor aesthetic)
- **Prisma** + SQLite (swap for Postgres in production)
- **NextAuth.js v4** (email/password credentials)
- **Socket.IO** mini-service (port 3003) for live event streaming + replay
- **TanStack Query** + **Zustand** for server/client state
- **Framer Motion** for the animated SVG diagram

## Quick start (local dev)

```bash
bun install
bun run db:push          # create the SQLite schema
bun run dev              # Next.js on :3000

# in another terminal — the Socket.IO live-stream service
cd mini-services/socket-service && bun run dev   # :3003
```

Open the app, click **"Explore the live demo"** to create a throwaway account preloaded with three sample projects (Customer Support Agent, Research Assistant, Code Review Bot), or sign up with email/password to get the same demo data.

## Docker

Two images are built from the multi-stage `Dockerfile`:

| Image              | Target      | Port | What it runs                              |
| ------------------ | ----------- | ---- | ----------------------------------------- |
| `agenttrace-web`   | `web`       | 3000 | Next.js standalone server + Prisma        |
| `agenttrace-socket`| `socket`    | 3003 | Socket.IO live-stream + replay service    |

```bash
# Build + run both services with docker-compose
docker compose up --build

# Or build the images directly
docker build --target web -t agenttrace-web .
docker build --target socket -t agenttrace-socket .
```

`docker-compose.yml` wires the two together: the Next.js container reaches the
socket container at `http://socket:3003` (set via `SOCKET_SERVICE_URL`). A
named volume persists the SQLite database. Configure secrets via environment
variables (see `.env.example`):

```env
NEXTAUTH_SECRET=<openssl rand -base64 32>
NEXTAUTH_URL=https://your-deployment.example
DATABASE_URL=file:/app/data/agenttrace.db   # or postgresql://...
SOCKET_SERVICE_URL=http://socket:3003
```

For production, swap SQLite for Postgres by setting `DATABASE_URL` to a
`postgresql://...` connection string and updating `prisma/schema.prisma`'
`datasource db` provider to `postgresql`.

## CI

`.github/workflows/ci.yml` runs on every push and pull request:

1. **lint** — `bun run lint` (ESLint)
2. **typecheck** — `bunx tsc --noEmit`
3. **build** — `bun run build` (validates the Next.js standalone output)
4. **docker build** — builds both `web` and `socket` images, then smoke-tests
   each (`curl` the web `/api/auth/providers` endpoint and the socket health
   endpoint from inside containers).

Docker layer caching is enabled via `type=gha` (GitHub Actions cache).

## Instrumenting an agent

The **Integration** page (in-app) generates copy-pasteable snippets with your
project's API key pre-filled. Three formats are provided:

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

### TypeScript
Same flow with `fetch` — see the Integration tab in the app.

### DeepAgents (LangChain)

The DeepAgents tab provides a drop-in `BaseCallbackHandler` that instruments a
`create_deep_agent` run. Attach one instance per invocation:

```python
from agenttrace_callback import AgentTraceCallback  # from the snippet
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
)

# one callback = one AgentTrace run
trace = AgentTraceCallback(run_name="research — Rust frameworks")
result = agent.invoke(
    {"messages": [{"role": "user", "content": "What's the state of Rust web frameworks?"}]},
    config={"callbacks": [trace]},
)
```

The callback streams, in real time:

| Event type      | Emitted from                   | Diagram arrow                |
| --------------- | ------------------------------ | ---------------------------- |
| `llm_call`      | `on_llm_start` / `on_llm_end`  | Orchestrator → LLM           |
| `tool_call`     | `on_tool_start`                | Orchestrator → tool          |
| `tool_result`   | `on_tool_end`                  | tool → Orchestrator          |
| `handoff`       | `on_agent_action` (handoff tool) | Orchestrator → Sub-agent   |
| `error`         | `on_tool_error`                | tool → Orchestrator (red)    |
| `final_answer`  | `on_agent_finish`              | Orchestrator → User          |

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

## Project structure

```
src/
  app/                    # Next.js App Router
    api/                  # auth, projects, runs, events, keys, stats, seed
    page.tsx              # routes by session status
  components/
    sequence-diagram/     # the live SVG diagram (centerpiece) + replay
    views/                # dashboard, projects, run, integration, settings
    layout/               # sidebar, footer
    auth/                 # auth screen
  lib/                    # auth, db, api, store, seed, types, socket-client
mini-services/
  socket-service/         # Socket.IO service (port 3003)
prisma/
  schema.prisma           # User, Project, Run, Event, ApiKey
Dockerfile                # multi-stage: web + socket targets
docker-compose.yml        # both services + volume
.github/workflows/ci.yml  # lint · typecheck · build · docker
```
