# Quickstart

## 1. Launch the dashboard

```bash
pip install deepagents-trace
agenttrace ui
```

You'll see the startup banner and the endpoints it's serving:

```text
    ___                    __ ______
   /   | ____ ____  ____  / //_  __/________ _________
  / /| |/ __ `/ _ \/ __ \/ __/ / / / ___/ __ `/ ___/ _ \
 / ___ / /_/ /  __/ / / / /_  / / / /  / /_/ / /__/  __/
/_/  |_\__, /\___/_/ /_/\__/ /_/ /_/   \__,_/\___/\___/
      /____/

  AgentTrace 0.1.5
  observability for AI agents

  Running the AgentTrace web UI:
    URL:        http://127.0.0.1:3000
    API:        http://127.0.0.1:3000/api
    WebSocket:  ws://127.0.0.1:3000/ws
    Database:   sqlite (agenttrace.db)
    Docs:       https://coulibaly-b.github.io/agenttrace

  Press CTRL+C to stop.
```

Open the URL, sign up, and a few demo projects are seeded so you can see the
sequence diagram immediately.

## 2. Get a project API key

In the dashboard: open (or create) a project → **Integration** tab → copy the
key (prefixed `atr_`). Configure the client with it, via environment variables
or explicitly:

| Env var | Default | Purpose |
| --- | --- | --- |
| `AGENTTRACE_URL` | `http://localhost:3000/api/events` | Ingestion endpoint |
| `AGENTTRACE_KEY` | — | Project API key (`atr_...`) |

## 3. Instrument your agent

=== "Cached-agent server (recommended)"

    Attach one callback handler per request — it also captures sub-agents.

    ```python
    from agenttrace_langchain import AgentTraceCallbackHandler, AsyncAgentTraceClient

    handler = AgentTraceCallbackHandler(
        "chat run", client=AsyncAgentTraceClient(api_key="atr_..."),
    )
    handler.on_user_message(user_text)

    config = {"configurable": {"thread_id": tid}, "callbacks": [handler]}
    async for _ in agent.astream_events(payload, version="v2", config=config):
        ...                       # your own UI dispatch
    await handler.finish("completed", answer=final_report)
    await handler.aclose()
    ```

    Full guide: [Callback handler](integration-callback.md).

=== "Agent built per invocation"

    One line in the agent build.

    ```python
    from agenttrace_langchain import AgentTraceMiddleware
    from deepagents import create_deep_agent

    agent = create_deep_agent(
        model=model,
        tools=[...],
        middleware=[AgentTraceMiddleware(run_name="research run", api_key="atr_...")],
    )
    agent.invoke({"messages": [{"role": "user", "content": "..."}]})
    ```

    Full guide: [Middleware](integration-middleware.md).

## 4. Watch it live

Run your agent. In the dashboard, open the project and its run — arrows appear
in real time as the agent reasons, calls tools, and delegates to sub-agents.
Sort runs by date / events / duration / name / status from the runs list.

!!! tip "Runnable notebooks"
    The `agenttrace-langchain` repo ships offline-runnable notebooks (no server
    or key needed) for both integration paths:
    [`examples/notebooks/`](https://github.com/CouLiBaLy-B/agenttrace/tree/main/integrations/agenttrace-langchain/examples/notebooks).
