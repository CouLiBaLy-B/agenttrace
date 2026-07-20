# agenttrace-langchain

`AgentTraceMiddleware` — an `AgentMiddleware` for LangChain's `create_agent` /
deepagents' `create_deep_agent` that streams a run to an
[AgentTrace](../../README.md) instance as a live sequence diagram.

## Install

```bash
pip install -e integrations/agenttrace-langchain
```

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
