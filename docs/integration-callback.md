# Callback handlers

A LangChain callback handler is attached per invocation, through
`config={"callbacks": [...]}`, or for the whole process. Unlike the
[middleware](integration-middleware.md), it isn't part of the compiled graph,
so it also works for an agent that is compiled once and reused. AgentTrace has
two handlers:

| | `AgentTraceCallbackHandler` | `AsyncAgentTraceCallbackHandler` |
| --- | --- | --- |
| Attached | for the whole process by `autolog()`, or per invocation | per request |
| One run per | top-level invocation | handler |
| Sends to | the tracking URI (`./agenttrace.db` by default) | a running `agenttrace ui`, over HTTP |
| LLM input (system prompt, messages) | not recorded | recorded |
| Sub-agents | their calls are recorded, on the orchestrator's lifeline | each sub-agent has its own lifeline |
| Hand-offs | tools whose name contains `handoff` or `delegate` | the same, plus a tool named exactly `task` (deepagents) |
| Final answer | the last message of the top-level output | what the app passes to `finish(answer=...)` |
| Anonymizer, labels | no | `anonymizer=`, `phrases=`, `tool_server=` |

## `autolog()` and `AgentTraceCallbackHandler`

```python
import agenttrace
import agenttrace.langchain

agenttrace.set_project("support-bot")
agenttrace.langchain.autolog()  # every invocation, from any thread
...
agenttrace.langchain.autolog(disable=True)
```

`autolog()` registers one `AgentTraceCallbackHandler` with LangChain, which
adds it to every invocation, including those started on other threads (a
FastAPI threadpool, say). Calling it again changes nothing;
`autolog(disable=True)` switches it off.

- Each **top-level invocation** becomes one run, named after the top-level
  runnable (for `create_agent`, its `name`), in the current project.
- Inside `agenttrace.start_run()`, invocations join that run instead, and the
  run stays open until the block ends. (The implicit run that `log_event()`
  uses outside `start_run()` is never joined.)
- Concurrent invocations don't mix: every event goes to the run of its own
  top-level invocation.
- It records `llm_call` (Orchestrator → model: an output preview, the token
  usage, the duration), `tool_call`, `tool_result` and `error`, a `handoff` for
  tools whose name contains `handoff` or `delegate`, and a `final_answer` with
  the last message of the top-level output. The run then ends `failed` if an
  LLM or tool call raised, else `completed`.
- Its methods never raise.

You can also pass it explicitly, to trace some invocations only or to give them
other options. When autolog is on as well, it leaves those invocations to your
handler, so nothing is traced twice:

```python
from agenttrace.langchain import AgentTraceCallbackHandler

handler = AgentTraceCallbackHandler(orchestrator="Planner")
agent.invoke(inputs, config={"callbacks": [handler]})
```

## `AsyncAgentTraceCallbackHandler`: one per request

For an async server that compiles its agent once (cached per user, say), create
a handler for each request. One handler traces the main agent and every
deepagents sub-agent, because LangGraph passes the callbacks on to nested
runs.

```python
from agenttrace.langchain import (
    AsyncAgentTraceCallbackHandler,
    AsyncHttpEventClient,
)

client = AsyncHttpEventClient(url="http://127.0.0.1:3000")  # once, at startup


async def chat(session_id: str, question: str) -> str:
    name = f"chat {session_id}"
    handler = AsyncAgentTraceCallbackHandler(name, client=client)
    handler.on_user_message(question)
    config = {
        "configurable": {"thread_id": session_id},
        "callbacks": [handler],
    }
    answer, status = None, "completed"
    try:
        async for event in agent.astream_events(
            {"messages": [{"role": "user", "content": question}]},
            version="v2",
            config=config,
        ):
            ...  # your own streaming to the client
            if event["event"] == "on_chain_end" and not event["parent_ids"]:
                answer = event["data"]["output"]["messages"][-1].content
    except Exception as exc:
        status = "failed"
        handler.on_error(str(exc))
        raise
    finally:
        await handler.finish(status, answer=answer)
        await handler.aclose()  # waits, bounded, until the events are sent
    return answer
```

Create the handler inside the request: it starts a background task on the
running event loop.

### What it records

| Event | Arrow | Content |
| --- | --- | --- |
| `llm_call` | agent → model | the input (system prompt and messages, or the prompts of a text model), an output preview, the token usage, the duration |
| `tool_call`, `tool_result` | agent → tool, tool → agent | the arguments; the result and the duration |
| `handoff` | Orchestrator → sub-agent | for a tool named exactly `task`, or whose name contains `handoff` or `delegate`; the sub-agent is named by the `subagent_type`, `to`, `name` or `agent` argument |
| `tool_result` or `error` | sub-agent → Orchestrator | when that tool returns, or raises |
| `error` | model or tool → agent | an LLM or tool call that raised |

"Agent" is `Orchestrator` or the sub-agent that made the call. deepagents runs
a sub-agent behind the `task` tool, and LangGraph runs the sub-agent's own
calls under the `task` call's namespace: the handler recognises that namespace,
on every request of a cached agent, and nested sub-agents too. The model's
lifeline is named after the model (`ls_model_name`, else the model id the
chat model was built with); a call that names no model reuses the last name
seen, so one model doesn't split into two lifelines.

### Lifecycle

The handler sees the LLM and tool calls on its own. The app supplies what a
callback can't see:

| Call | Records |
| --- | --- |
| `handler.on_user_message(text)` | the opening `handoff`, User → Orchestrator |
| `handler.approval_required(info)` | a human-in-the-loop pause your app detects (from the graph state): a `handoff` Orchestrator → User, with status `pending` |
| `handler.on_error(message)` | a run-level failure: an `error`, Orchestrator → User |
| `await handler.finish(status="completed", answer=None)` | the `final_answer` (when `answer` is given), then the end of the run: `failed` for `"failed"` or `"error"`, else `completed` |
| `await handler.aclose(timeout=10.0)` | waits until the queued events are sent (at most `timeout` seconds), then stops the background task |

`finish()` doesn't wait for the events: a server can send its own response
first and call `aclose()` afterwards, so tracing adds no latency.

### Where it sends

`AsyncHttpEventClient(url=None, api_key=None, timeout=10.0, client=None)`:

- `url`: the server's base URL (`http://127.0.0.1:3000`) or its full
  `/api/events` URL. Default: `AGENTTRACE_URL`, else
  `http://localhost:3000/api/events`.
- `api_key`: the `atr_...` project key; default `AGENTTRACE_KEY`. Without a
  key, nothing is sent as `Authorization` and each run names its project (the
  current one), which a server running with `--auth none` accepts. A server
  that wants a key answers 401, and the run turns off with one warning.
- `client`: your own `httpx.AsyncClient`, to pool connections across requests.
  Otherwise one is created on first use; `AsyncHttpEventClient.aclose()` only
  closes an `httpx` client it created.

Build one client at startup and share it. Without `client=`, the handler posts
to the tracking URI (`set_tracking_uri()`, `AGENTTRACE_TRACKING_URI`), which
must then be `http://` or `https://`: anything else raises a `ValueError` when
the handler is created.

### Anonymizer

`anonymizer=` takes a function that the handler calls on everything free-form
it sends: each event's payload (a JSON-safe dict, in which values that aren't
JSON became strings), each label and the run name (strings), and a sub-agent
name read from hand-off arguments.

- **Full values first.** Values are anonymized whole and truncated afterwards,
  so a sensitive value cut at a size limit can't slip through as a fragment
  your patterns no longer match.
- **Fails closed.** If the function raises, the field is replaced, never sent
  unmasked: a payload by `{"redacted": "anonymizer failed"}`, a label or the
  run name by `[redacted]`. A label or run name that comes back as anything but
  a string is `[redacted]` too. One warning is logged per run, without the
  values.
- **Sub-agent names.** A name that the anonymizer changes, or fails on, becomes
  `Sub-agent`. Names are cut at 60 characters.
- Participant names (the orchestrator, tools, models, `User`) are not
  anonymized.

```python
import json
import re

EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")


def scrub(value):
    if isinstance(value, str):
        return EMAIL.sub("<email>", value)
    return json.loads(EMAIL.sub("<email>", json.dumps(value)))


handler = AsyncAgentTraceCallbackHandler(
    "chat", client=client, anonymizer=scrub
)
```

### Labels and other options

`phrases=` overrides the labels below, for example to translate them; `{name}`
and `{target}` are filled in.

| Key | Default | Label of |
| --- | --- | --- |
| `user_message_fallback` | `user message` | `on_user_message("")` |
| `tool_result` | `{name} → result` | a tool result |
| `delegate` | `delegate → {target}` | a hand-off |
| `subagent_done` | `{name} → done` | a sub-agent returning |
| `subagent_failed` | `{name} → failed` | a sub-agent raising |
| `approval_required` | `HITL: approval required` | `approval_required()` |
| `final_answer` | `final answer` | `finish(answer=...)` |
| `run_failed` | `run failed` | `on_error()` |

The `llm step`, `llm failed` and `<tool> failed` labels are fixed.

- `tool_server=` takes a function of the tool name; its result is added to
  tool arrows as `payload.server`, for example the MCP server that ran the
  tool.
- `orchestrator=` renames the main agent's lifeline (default `Orchestrator`).

### Reliability

As with the rest of the SDK, tracing never breaks the request: events go to an
`asyncio.Queue` drained by one background task per run, the first failure
turns tracing off for that run with one warning, and payloads are bounded
(output previews at 240 characters, tool results and the final answer at 500,
messages at 500 each and the system prompt at 320 in the LLM input).

!!! tip "Runnable notebook"
    [`02_async_callback_handler.ipynb`](https://github.com/CouLiBaLy-B/agenttrace/blob/main/python-server/examples/notebooks/02_async_callback_handler.ipynb)
    runs a cached agent with a sub-agent, the anonymizer and translated labels
    offline, against an in-process `agenttrace ui`.

The 0.2.2 import `from agenttrace_langchain import AgentTraceCallbackHandler`
is this class (deprecated).
