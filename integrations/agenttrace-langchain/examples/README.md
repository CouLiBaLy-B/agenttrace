# Examples

Minimal, runnable projects showing `AgentTraceMiddleware` on a simple
research agent — sync and async, side by side. Both use the exact same
tools/prompt/middleware wiring; only the invocation differs (`agent.invoke()`
vs `await agent.ainvoke()`), and the middleware's async hooks fire
automatically for the async case — no separate setup needed.

| File | Shows |
| --- | --- |
| [`sync_basic.py`](sync_basic.py) | `create_deep_agent(...).invoke(...)` |
| [`async_basic.py`](async_basic.py) | `await create_deep_agent(...).ainvoke(...)` |

## Setup

```bash
cd examples
pip install -e ..
pip install deepagents langchain-openai

export OPENAI_API_KEY=...
export AGENTTRACE_KEY=atr_...          # project API key, from the AgentTrace Integration tab
export AGENTTRACE_URL=http://localhost:3000/api/events   # default, override for a remote instance
```

An AgentTrace instance must be running to see the trace (see the main repo's
README — `agenttrace ui`, or `bun run agenttrace` for the Next.js stack).
Without it, the examples still run the agent correctly; the middleware just
logs a warning and disables tracing for that run (non-blocking, never fatal —
see the package [README](../README.md#reliability)).

## Run

```bash
python sync_basic.py
python async_basic.py
```

Then open the run in AgentTrace to watch the sequence diagram populate live,
or replay it afterward.
