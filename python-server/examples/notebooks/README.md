# Notebooks

Two runnable notebooks for the `lanetrace` SDK. Both run offline:
scripted chat models from `langchain_core` stand in for the LLMs, and traces go
to a SQLite file in a temporary directory. No server to start, no network, no
API key.

| Notebook | Covers |
| --- | --- |
| [`01_quickstart.ipynb`](01_quickstart.ipynb) | `lanetrace.langchain.autolog()`, `LaneTraceMiddleware` and the fluent API (`start_run`, `log_event`, `@lanetrace.trace`), written straight to SQLite. |
| [`02_async_callback_handler.ipynb`](02_async_callback_handler.ipynb) | `AsyncLaneTraceCallbackHandler`, one per request, for an async server that reuses a compiled agent: sub-agent lanes, the anonymizer, localized labels and the request lifecycle. It posts to the `lanetrace ui` app, run in-process. |

## Run them

```bash
pip install 'lanetrace[langchain,server]' jupyter
jupyter lab python-server/examples/notebooks
```

Then run all cells. Each notebook ends with the `lanetrace ui --database-url ...`
command that opens its runs in the dashboard.

To check them headless without touching the committed files:

```bash
jupyter nbconvert --to notebook --execute --output-dir /tmp/notebooks python-server/examples/notebooks/*.ipynb
```

They are committed without outputs (outputs hold local paths): clear them
before committing a change.
