# Middleware

`AgentTraceMiddleware` is an `AgentMiddleware` for LangChain's `create_agent`
and deepagents' `create_deep_agent`. Use it when the agent is **built for each
invocation**: one middleware instance is one run. A server that compiles its
agent once and reuses it across requests would trace every request into the
same run; it needs a [callback handler](integration-callback.md) instead.

```python
from agenttrace.langchain import AgentTraceMiddleware
from deepagents import create_deep_agent

agent = create_deep_agent(
    model=model,
    tools=[web_search],
    middleware=[AgentTraceMiddleware(run_name="research run")],
)
question = "What's the state of Rust web frameworks?"
agent.invoke({"messages": [{"role": "user", "content": question}]})
```

`await agent.ainvoke(...)` works the same way: the middleware implements the
async hooks too.

## Options

| Argument | Default | Meaning |
| --- | --- | --- |
| `run_name` | `"deepagents run"` | the run's name |
| `orchestrator` | `"Orchestrator"` | the name of the agent's lifeline |
| `project` | the current project | the run's project, when no API key is used |
| `url` | `None` | post to this server instead of the tracking URI: its base URL (`https://traces.example.com`) or its `/api/events` URL |
| `api_key` | `None` | the `atr_...` project key sent to that server |
| `timeout` | `10.0` | HTTP timeout, in seconds |

Without `url` and `api_key`, the middleware writes to the
[tracking URI](mlflow.md#tracking-uris), like the rest of the SDK:
`./agenttrace.db` by default. Given either one, it posts to `url` (else
`AGENTTRACE_URL`, else `http://localhost:3000/api/events`) with `api_key` (else
`AGENTTRACE_KEY`), as before version 0.2. With a key, the key decides the
project.

## What it records

| Hook | Event | Arrow |
| --- | --- | --- |
| `wrap_model_call` | `llm_call`: the input (system prompt and messages), an output preview, the token usage and the duration | Orchestrator → model |
| `wrap_tool_call`, before the call | `tool_call`, with the arguments | Orchestrator → tool |
| `wrap_tool_call`, for a tool whose name contains `handoff` or `delegate` | also a `handoff`, to the sub-agent named by the `subagent_type`, `to`, `name` or `agent` argument (else `Sub-agent`) | Orchestrator → sub-agent |
| `wrap_tool_call`, after the call | `tool_result`, with the result and the duration | tool → Orchestrator |
| `wrap_tool_call`, when the tool raises | `error`; the exception propagates as usual | tool → Orchestrator |
| `after_agent` | `final_answer`, the last message; the run then ends `failed` if a tool raised, else `completed` | Orchestrator → User |

The run itself is created with its first event. The model's lifeline is named
after the model (its `model` or `model_name` attribute), else `LLM`.

The middleware sees only the agent it is attached to. A deepagents sub-agent
runs as a separate graph behind the `task` tool: the middleware records the
`task` call and its result as a plain tool call, but not the sub-agent's own
LLM and tool calls. [`AsyncAgentTraceCallbackHandler`](integration-callback.md#asyncagenttracecallbackhandler-one-per-request)
records those, on the sub-agent's own lifeline.

## Reliability

The middleware never gets in the agent's way:

- **non-blocking**: events go to a queue that a background thread drains, so
  model and tool calls never wait for a write. At the end of the run,
  `after_agent` waits at most 10 seconds for the queue to drain;
- **never fatal**: the first storage or HTTP error turns tracing off for the
  run, with one warning through `logging`, and the agent carries on;
- **bounded**: tool arguments are cut at 80 characters in the label and 2,000
  in the payload, tool results and the final answer at 500, LLM output
  previews at 240; in the LLM input, each message is cut at 500 characters and
  the system prompt at 320.

The pre-0.2 import, `from agenttrace_langchain import AgentTraceMiddleware`,
still works through the deprecated `agenttrace-langchain` package.
