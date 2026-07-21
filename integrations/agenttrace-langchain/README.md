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

For a cached-agent server there are two options: attach a **callback handler**
per request (recommended — least code), or drive an `AsyncAgentTraceRun` from
your own stream projection (below).

### Recommended: `AgentTraceCallbackHandler` (one callback, minimal wiring)

`AgentTraceCallbackHandler` is a LangChain `AsyncCallbackHandler`. You attach a
fresh one **per request** via `config={"callbacks": [handler]}` on your
`astream_events`/`ainvoke` call — nothing is baked into the cached graph, so
reuse across requests is safe. One top-level handler fires for the main agent
**and every deepagents sub-agent** (LangGraph propagates callbacks down the
ambient `RunnableConfig`), so you don't hand-map the stream at all:

```python
from agenttrace_langchain import AgentTraceCallbackHandler, AsyncAgentTraceClient

handler = AgentTraceCallbackHandler(
    "chat run",
    client=AsyncAgentTraceClient(api_key="atr_..."),
    anonymizer=my_scrubber,        # optional; applied to EVERY event payload
    phrases={"final_answer": "réponse finale"},   # optional label overrides
)
handler.on_user_message(user_text)

config = {"configurable": {"thread_id": tid}, "callbacks": [handler]}
async for event in agent.astream_events(payload, version="v2", config=config):
    ...                            # your own UI dispatch — untouched by tracing

# Two things a callback can't derive — the app supplies them:
#   handler.approval_required(interrupt_info)      # HITL pause (read from graph state)
await handler.finish("completed", answer=final_report)   # emits final_answer + closes
```

The handler captures on its own: LLM **input** (system + messages) at
`on_chat_model_start`, LLM **output + token usage** at `on_llm_end`, tool
call/result (with duration), sub-agent handoffs (the `task` tool and any
`handoff`/`delegate` tool), and tool/LLM errors — each attributed to the main
agent or the emitting sub-agent node (via `metadata["langgraph_node"]` /
`checkpoint_ns`). It works identically whether you consume `astream_events`
v2 or v3, since callbacks fire at the runnable level, not the stream level.

`anonymizer` is any `Callable[[Any], Any]` (e.g.
`langsmith.anonymizer.create_anonymizer(rules)`): it runs on every event
payload right before send, once, instead of masking at each call site. It's
never fatal — a raising anonymizer logs a warning and the payload passes
through rather than breaking the run.

### Lower-level: `AsyncAgentTraceRun` + your own projection

If you already project `agent.astream_events(...)` into your own typed events
and would rather feed those directly, create one `AsyncAgentTraceRun` **per
request** and call `on_stream_event`:

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

A stream projection typically doesn't expose LLM call boundaries, so on this
lower-level path token usage/`llm_call` still needs a callback. Prefer
`AgentTraceCallbackHandler` above, which already captures LLM input/output/
tokens **and** tool/sub-agent arrows in a single handler. `AsyncAgentTraceRun`
also accepts the same optional `anonymizer=` callable, applied to every
emitted payload.

## Event mapping

| Event type | Emitted from | Diagram arrow |
| --- | --- | --- |
| `llm_call` | `wrap_model_call` | Orchestrator → LLM (payload: `input` — system prompt + messages sent — and `output_preview`) |
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
