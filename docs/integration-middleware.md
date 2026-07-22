# Middleware

`AgentTraceMiddleware` is an `AgentMiddleware` for deepagents' `create_deep_agent`
/ LangChain's `create_agent`. Use it when your agent graph is **built per
invocation** (a fresh graph each run). For a server that compiles the agent
once and reuses it, use the [callback handler](integration-callback.md) instead.

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

Works the same with `await agent.ainvoke(...)` — the async hooks fire
automatically. One `AgentTraceMiddleware` instance = one AgentTrace run.

## Configuration

Set the target instance and project key via environment variables
(`AGENTTRACE_URL`, `AGENTTRACE_KEY`) or explicitly:

```python
AgentTraceMiddleware(
    run_name="research run",
    url="https://your-deployment/api/events",  # or AGENTTRACE_URL
    api_key="atr_...",                          # or AGENTTRACE_KEY
    timeout=10.0,
)
```

## Reliability

The middleware never affects the agent it instruments:

- **Non-blocking** — every event is pushed onto a queue drained by a background
  thread; the hooks never wait on the HTTP call.
- **Never fatal** — a missing key or the first network/HTTP failure disables
  tracing for that run (one warning logged), the agent keeps running.
- **Bounded payloads** — tool args/results, LLM output previews and the final
  answer are truncated before being sent.

## How hooks map to arrows

| Hook | Event |
| --- | --- |
| `before_agent` | creates the run (lazily, on first event) |
| `wrap_model_call` | `llm_call` (Orchestrator → LLM) |
| `wrap_tool_call` | `tool_call` / `tool_result` / `error`, and `handoff` when the tool is a delegation |
| `after_agent` | `final_answer`, then closes the run |

See the full [event contract](events.md).
