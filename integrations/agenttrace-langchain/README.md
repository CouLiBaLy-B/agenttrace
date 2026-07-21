# agenttrace-langchain

Published on PyPI: [pypi.org/project/agenttrace-langchain](https://pypi.org/project/agenttrace-langchain/)

`AgentTraceMiddleware` — an `AgentMiddleware` for LangChain's `create_agent` /
deepagents' `create_deep_agent` that streams a run to an
[AgentTrace](../../README.md) instance as a live sequence diagram. Also
ships `AsyncAgentTraceClient`/`AsyncAgentTraceRun` for servers that cache and
reuse a compiled agent across requests — see
["Servers with a cached/reused agent"](#servers-with-a-cachedreused-agent-dont-use-the-middleware) below.

## Install

```bash
pip install agenttrace-langchain
```

For local development against this checkout instead: `pip install -e integrations/agenttrace-langchain`.

## Usage

```python
from agenttrace_langchain import AgentTraceMiddleware
from deepagents import create_deep_agent

agent = create_deep_agent(
    model=model,
    tools=[...],
    middleware=[AgentTraceMiddleware(run_name="research run")],
)
agent.invoke({"messages": [{"role": "user", "content": "..."}]})
```

Works the same with `await agent.ainvoke(...)` — the middleware's async hooks
fire automatically. See [`examples/`](examples) for full sync and async
runnable projects.

Configure the target instance and project API key (from the AgentTrace
Integration tab, prefixed `atr_`) via environment variables, or pass them
explicitly to the middleware:

| Env var | Default | Purpose |
| --- | --- | --- |
| `AGENTTRACE_URL` | `http://localhost:3000/api/events` | Ingestion endpoint |
| `AGENTTRACE_KEY` | — | Project API key |

```python
middleware = AgentTraceMiddleware(
    run_name="research run",
    url="https://your-deployment/api/events",
    api_key="atr_...",
    timeout=10.0,
)
```

## Reliability

The middleware is built to never affect the agent it instruments:

- **Non-blocking** — every event is pushed onto a queue drained by a
  background thread; `wrap_model_call`/`wrap_tool_call` never wait on the
  AgentTrace HTTP call.
- **Never fatal** — a missing API key or the first network/HTTP failure
  disables tracing for that run (one warning logged via the standard
  `logging` module), the agent keeps running normally.
- **Bounded payloads** — tool args/results, LLM output previews and the
  final answer are truncated (`agenttrace_langchain.run.truncate`/`compact`)
  before being sent, so a single large value can't blow up an event body.

`AgentTraceRun` (`run.py`) implements this contract and can be reused
directly if you're not going through the middleware (e.g. to trace a custom
orchestration loop):

```python
from agenttrace_langchain import AgentTraceClient, AgentTraceRun

run = AgentTraceRun("custom run", client=AgentTraceClient(api_key="atr_..."))
run.emit(source="Orchestrator", target="LLM", type="llm_call", label="step")
run.end("completed")
run.close()  # bounded wait for the queue to drain
```

`AgentTraceClient` (`client.py`) itself stays a thin, fail-loud HTTP
primitive (raises on a missing key or a failed request) — the right
behavior when called directly; `AgentTraceRun` is the layer that adds the
non-blocking/never-fatal guarantees on top.

## Servers with a cached/reused agent (don't use the middleware)

`AgentTraceMiddleware` is baked into the agent graph at `create_deep_agent(...,
middleware=[...])` **build** time. If your server compiles the agent once and
reuses it across many requests (e.g. a per-user compiled-graph cache with a
TTL), a single middleware instance would span multiple runs — the first
run's `after_agent` closes the AgentTrace run, and every later request on that
cached agent silently traces into an already-closed run. The middleware is
only correct when the agent is (re)built per invocation.

For a cached-agent server, create one `AsyncAgentTraceRun` **per request**
instead, independent of the agent build, and feed it events from your own
stream projection (`agent.astream_events(...)`) rather than from `middleware`:

```python
from agenttrace_langchain import AsyncAgentTraceClient, AsyncAgentTraceRun

client = AsyncAgentTraceClient(api_key="atr_...")  # reuse across runs; own httpx.AsyncClient optional
run = AsyncAgentTraceRun("chat run", client=client, tool_server=my_mcp_routing_fn)

run.on_user_message(user_text)
async for kind, source, data in my_stream_projection(agent, ...):
    run.on_stream_event(kind, source, data)  # tool_call/tool_result/agent_start/agent_end/approval_required/final
run.end("completed")
await run.aclose()
```

`tool_server` is an optional `Callable[[str], str]` — pass it if you want a
`payload.server` label on tool arrows (e.g. which MCP/backend served a tool
call); omit it if you don't need that.

`on_stream_event`'s diagram labels default to English ("delegate → X",
"failed"/"done", "final answer", ...) — override any of them with `phrases`
(merged over the defaults in `async_run.DEFAULT_PHRASES`), e.g. to localize:

```python
run = AsyncAgentTraceRun(
    "chat run",
    client=client,
    phrases={
        "delegate": "délégation → {target}",
        "subagent_failed": "{name} → échec",
        "final_answer": "réponse finale",
    },
)
```

Token usage still needs a `BaseCallbackHandler` (attach via
`config={"callbacks": [...]}` at invoke time) since a stream projection
typically doesn't expose LLM call boundaries — callbacks, unlike middleware,
correctly compose with a cached/reused agent because they're attached
per-invocation rather than baked into the graph.

## Event mapping

| Event type | Emitted from | Diagram arrow |
| --- | --- | --- |
| `llm_call` | `wrap_model_call` | Orchestrator → LLM |
| `tool_call` | `wrap_tool_call` (before) | Orchestrator → tool |
| `tool_result` | `wrap_tool_call` (after) | tool → Orchestrator |
| `handoff` | `wrap_tool_call` (tool name matches `handoff`/`delegate`) | Orchestrator → Sub-agent |
| `error` | `wrap_tool_call` (exception) | tool → Orchestrator (red) |
| `final_answer` | `after_agent` | Orchestrator → User |

## Tests

```bash
pip install -e ".[dev]"
pytest
```

## Releasing a new version

**Published**: [pypi.org/project/agenttrace-langchain](https://pypi.org/project/agenttrace-langchain/) —
Trusted Publishing (OIDC) is set up, no API token stored as a GitHub secret.

To ship a new version:

1. Bump `version` in `pyproject.toml`.
2. Commit, then push a tag matching `agenttrace-langchain-v*` (e.g.
   `agenttrace-langchain-v0.1.1`) — `.github/workflows/publish-agenttrace-langchain.yml`
   (repo root) builds and publishes automatically. A GitHub Release
   (`published` event) also triggers it, or run the workflow manually
   (`workflow_dispatch`).
3. Locally, verify before tagging: `python -m build && twine check dist/*`
   in this directory.

Trusted publisher config on pypi.org (Publishing → Trusted publishers), for
reference/if it ever needs re-registering: project `agenttrace-langchain`,
owner `CouLiBaLy-B`, repo `agenttrace`, workflow
`publish-agenttrace-langchain.yml`, environment `pypi-agenttrace-langchain`
(kept distinct from `deepagents-trace`'s `pypi` environment so the two
packages' publish permissions stay independent).
