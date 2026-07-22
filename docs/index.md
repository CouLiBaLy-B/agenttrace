# AgentTrace

**Observability for AI agents.** AgentTrace renders a deepagents / LangChain
run as a **live sequence diagram** — User → Orchestrator → LLM, tools, and
sub-agents — as it happens, with per-arrow timing, token usage, tool
arguments/results, and the final answer.

It ships as two pieces:

| Package | Install | What it is |
| --- | --- | --- |
| **`deepagents-trace`** | `pip install deepagents-trace` | The dashboard + API, 100% Python (FastAPI + a pre-built frontend). Launch with `agenttrace ui` — no Node/Bun required, `mlflow ui`-style. |
| **`agenttrace-langchain`** | `pip install agenttrace-langchain` | The client that streams your agent's run to a dashboard: a `AgentTraceMiddleware`, an `AgentTraceCallbackHandler`, and lower-level run primitives. |

## How it fits together

```
your agent (deepagents / LangChain)
      │  middleware or callback handler (agenttrace-langchain)
      ▼
  POST /api/events  ──────────►  AgentTrace dashboard (deepagents-trace)
                                 live sequence diagram in the browser
```

The client emits small, bounded events over `POST /api/events`; the dashboard
stores them and streams them to the browser over a WebSocket. The contract is
stable and language-agnostic — see [Event contract](events.md).

## Pick your integration

- **Agent built per invocation?** Use the [middleware](integration-middleware.md) — one line in `create_deep_agent(...)`.
- **Server that caches/reuses a compiled agent across requests?** Use the [callback handler](integration-callback.md) — attach one per request, it also captures sub-agents.

## Next steps

<div class="grid cards" markdown>

- :material-download: **[Install](install.md)** — get the dashboard and the client.
- :material-rocket-launch: **[Quickstart](quickstart.md)** — `agenttrace ui`, a project key, first trace.
- :material-sitemap: **[Event contract](events.md)** — the JSON your agent sends.

</div>
