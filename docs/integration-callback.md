# Callback handler

`AgentTraceCallbackHandler` is a LangChain `AsyncCallbackHandler` you attach
**per request** via `config={"callbacks": [handler]}`. It's the right tool for a
server that **compiles the agent once and reuses it** across requests — a
middleware, baked into the graph at build time, would span multiple runs.

One top-level handler fires for the main agent **and every deepagents
sub-agent** (LangGraph propagates callbacks down the ambient config), capturing:
LLM input/output/tokens, tool call/result, sub-agent handoffs, and errors —
each attributed to the main agent or the emitting sub-agent.

## Minimal integration

```python
from agenttrace_langchain import AgentTraceCallbackHandler, AsyncAgentTraceClient

client = AsyncAgentTraceClient(api_key="atr_...")   # reuse across runs

# per request:
handler = AgentTraceCallbackHandler("chat run", client=client)
handler.on_user_message(user_text)

config = {"configurable": {"thread_id": tid}, "callbacks": [handler]}
async for event in agent.astream_events(payload, version="v2", config=config):
    ...                                # your own UI dispatch — untouched by tracing

# things a callback can't derive — the app supplies them:
#   handler.approval_required(interrupt_info)   # HITL pause (read from graph state)
await handler.finish("completed", answer=final_report)
await handler.aclose()
```

Works whether you consume `astream_events` v2 or v3 — callbacks fire at the
runnable level, not the stream level.

## Lifecycle

The callback captures LLM/tool/sub-agent events on its own. The app supplies
only what a callback can't observe:

| Call | When |
| --- | --- |
| `handler.on_user_message(text)` | opening User → Orchestrator arrow |
| `handler.approval_required(info)` | a HITL pause (from graph state, not a callback event) |
| `await handler.finish(status, answer=...)` | emit the assembled final answer, mark the run ended |
| `await handler.aclose()` | drain the queue (bounded) — call it **after** your own `done` so tracing never adds latency |

## PII anonymization

Pass an `anonymizer` (any `Callable[[Any], Any]`) once; it runs on **every**
event payload right before send — instead of masking at each call site. Never
fatal: a raising anonymizer logs a warning and the payload passes through. Pair
it with, e.g., `langsmith.anonymizer.create_anonymizer(rules)`.

```python
handler = AgentTraceCallbackHandler(
    "chat run", client=client, anonymizer=my_scrubber,
)
```

## Localized diagram labels

Override any default English label (merged over `async_run.DEFAULT_PHRASES`);
`{name}` / `{target}` are filled with `str.format`.

```python
handler = AgentTraceCallbackHandler(
    "chat run", client=client,
    phrases={
        "delegate": "délégation → {target}",
        "subagent_done": "{name} → retour",
        "final_answer": "réponse finale",
    },
)
```

## Tool → backend labels

Pass `tool_server: Callable[[str], str]` to add a `payload.server` label on tool
arrows (e.g. which MCP/backend served a tool call).

## Sub-agent attribution

deepagents runs a delegated sub-agent under the `task` tool. LangGraph labels
every LLM node structurally (`"model"`), so the handler recovers the sub-agent
from the `task` call's `checkpoint_ns` — a sub-agent's own LLM/tool calls land
on the **sub-agent lane**, not the orchestrator, and the delegation shows as a
`handoff` arrow.

!!! tip "Runnable notebook"
    See [`examples/notebooks/02_callback_handler.ipynb`](https://github.com/CouLiBaLy-B/agenttrace/tree/main/integrations/agenttrace-langchain/examples/notebooks)
    — runs fully offline and demonstrates handoff, anonymization, and phrases.
