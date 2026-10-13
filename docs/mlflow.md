# Coming from MLflow

The tracking API follows MLflow's, so most names carry over.

| MLflow | AgentTrace |
| --- | --- |
| `mlflow.set_tracking_uri()` / `MLFLOW_TRACKING_URI` | `agenttrace.set_tracking_uri()` / `AGENTTRACE_TRACKING_URI` |
| `mlflow.get_tracking_uri()` | `agenttrace.get_tracking_uri()` |
| `mlflow.set_experiment()` / `MLFLOW_EXPERIMENT_NAME` | `agenttrace.set_project()` / `AGENTTRACE_PROJECT` |
| `mlflow.start_run()` / `active_run()` / `end_run()` | the same names |
| `@mlflow.trace` | `@agenttrace.trace` |
| `mlflow.langchain.autolog()` | `agenttrace.langchain.autolog()` |
| `MlflowClient` | `agenttrace.AgentTraceClient` |
| `mlflow ui` | `agenttrace ui` |

## What differs

- A run is an ordered list of **events**, not params and metrics. Each event
  is one arrow of the diagram: a `source`, a `target`, a `type` (`llm_call`,
  `tool_call`, `tool_result`, `handoff`, `error` or `final_answer`), and
  optionally a `label`, a JSON `payload`, a duration and a status. See the
  [event contract](events.md).
- A **project** plays the experiment's part. Projects are created on first use,
  by name; without `set_project()` or `AGENTTRACE_PROJECT`, runs go to
  `Default`.
- `start_run()` returns the run, which is a context manager: leaving the block
  ends it `completed`, or `failed` if an exception escaped. `end_run(status)`
  ends the current run.
- `log_event()` and `@agenttrace.trace` don't block and don't raise (except a
  `ValueError` for an unknown event type): each run writes from its own
  background thread, and a storage error turns tracing off for that run.
  Ending a run, with `end_run()` or by leaving the `start_run()` block, waits
  for its writes, at most 10 seconds. An exit hook ends and flushes the runs
  still open, so short scripts don't lose their last events.

## Tracking URIs

The tracking URI is the first of:

1. `agenttrace.set_tracking_uri(uri)`;
2. `AGENTTRACE_TRACKING_URI`;
3. `AGENTTRACE_URL`, the pre-0.2 variable: a full `.../api/events` URL, of
   which the server part is used;
4. `http://localhost:3000`, when only `AGENTTRACE_KEY` is set (the pre-0.2
   default server; a warning says so once);
5. `sqlite:///./agenttrace.db`.

| Tracking URI | Runs go to |
| --- | --- |
| `sqlite:///./agenttrace.db` (the default) or another SQLite file | that file, written directly; `agenttrace ui` reads it (`--database-url` for another file) |
| another SQLAlchemy URL, such as `postgresql+psycopg://...` | that database, written directly; the tables are created on the first write |
| `http://host:port` or `https://...` | a running `agenttrace ui`, through `POST /api/events` |

Over HTTP, `AGENTTRACE_KEY` is sent when it is set: the run then goes to that
key's project, and `set_project()` is ignored. Without a key, each run names its
project, which only a server running with `--auth none` accepts.

## The explicit client

Like `MlflowClient`, `AgentTraceClient` is synchronous and raises on any error:

```python
from agenttrace import AgentTraceClient

client = AgentTraceClient()  # or AgentTraceClient("postgresql+psycopg://...")
run_id = client.create_run("nightly eval", project="evals")
client.log_event(run_id, source="Orchestrator", target="LLM", type="llm_call")
client.end_run(run_id, "completed")
```
