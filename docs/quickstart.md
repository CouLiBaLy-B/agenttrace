# Quickstart

## 1. Start the dashboard

```bash
pip install 'lanetrace[langchain,server]'
lanetrace demo    # optional: three sample projects with their runs
lanetrace ui
```

`lanetrace ui` prints where everything is, then serves the dashboard:

```text
    __                   ______
   / /   ____ _____  ___/_  __/________ _________
  / /   / __ `/ __ \/ _ \/ / / ___/ __ `/ ___/ _ \
 / /___/ /_/ / / / /  __/ / / /  / /_/ / /__/  __/
/_____/\__,_/_/ /_/\___/_/ /_/   \__,_/\___/\___/

  LaneTrace 0.3.0
  observability for AI agents

  Dashboard   http://127.0.0.1:3000
  Auth        none (no login, no API key)
  Database    sqlite:///./lanetrace.db  (/home/you/my-agent/lanetrace.db)
  Tracking    LANETRACE_TRACKING_URI=http://127.0.0.1:3000
              set it where your agents run to send their traces here
  Docs        https://coulibaly-b.github.io/lanetrace/
```

Open the dashboard URL. On localhost there is no login: everything belongs to
one local user. The **Database** line shows the file the dashboard reads. The
SDK writes to `./lanetrace.db` too, relative to the directory your agent runs
in: run the agent from the same directory, or send its runs over HTTP
([step 4](#4-send-runs-from-elsewhere)).

## 2. Trace a LangChain or deepagents agent

```python
import lanetrace
import lanetrace.langchain

lanetrace.set_project("support-bot")   # like mlflow.set_experiment()
lanetrace.langchain.autolog()   # like mlflow.langchain.autolog()

agent.invoke({"messages": [{"role": "user", "content": "Where's my order?"}]})
```

Each top-level invocation becomes one run of the `support-bot` project. Open it
in the dashboard while the agent runs and watch the arrows arrive. The
[callback handlers](integration-callback.md) page covers what is recorded, and
the [middleware](integration-middleware.md) is the explicit alternative.

## 3. Trace anything else

```python
import lanetrace

lanetrace.set_project("support-bot")


@lanetrace.trace   # a tool_call, then its tool_result (or an error)
def web_search(query: str) -> str:
    ...


with lanetrace.start_run("triage"):
    lanetrace.log_event(
        source="User", target="Orchestrator", type="handoff",
        label="Where is my order?",
    )
    lanetrace.log_event(
        source="Orchestrator", target="LLM", type="llm_call", duration_ms=480
    )
    web_search("order 4521")
    lanetrace.log_event(
        source="Orchestrator", target="User", type="final_answer",
        label="It shipped yesterday.",
    )
```

Outside a `start_run()` block, `log_event()` and `@lanetrace.trace` use one
implicit run per process, ended by `lanetrace.end_run()` or when the process
exits. Tracing never raises into your code, except a `ValueError` for an
unknown event type: events are written from a background thread, and a storage
error turns tracing off for that run, with one logged warning.

## 4. Send runs from elsewhere

When the agent runs on another machine, in a container or from another
directory, send its runs to the dashboard over HTTP:

```bash
# the banner's Tracking line; the key only for a server with --auth password
export LANETRACE_TRACKING_URI=http://127.0.0.1:3000
export LANETRACE_KEY=atr_...
```

`lanetrace ui` uses password mode by default when it listens on an address
other than localhost. Sign up in the browser; on the **Integration** page,
**Regenerate key** creates a project key and shows it once.

## Notebooks

Two notebooks run all of the above offline, with scripted models and a
temporary SQLite file:
[`python-server/examples/notebooks/`](https://github.com/CouLiBaLy-B/lanetrace/tree/main/python-server/examples/notebooks).
