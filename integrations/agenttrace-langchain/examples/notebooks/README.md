# Usage notebooks

Runnable Jupyter notebooks for `agenttrace-langchain`. Both run **fully
offline** — a fake chat model and a mocked HTTP client capture the emitted
events, so no AgentTrace server or API key is needed to follow along. Each ends
with the real-server configuration.

| Notebook | Covers |
| --- | --- |
| [`01_quickstart_middleware.ipynb`](01_quickstart_middleware.ipynb) | `AgentTraceMiddleware` on a per-invocation `create_deep_agent` — the simplest path. Event mapping table. |
| [`02_callback_handler.ipynb`](02_callback_handler.ipynb) | `AgentTraceCallbackHandler` for servers that cache/reuse a compiled agent. Sub-agent attribution, PII `anonymizer`, localized `phrases`, and the lifecycle (`on_user_message` / `approval_required` / `finish` / `aclose`). |

## Run them

```bash
pip install agenttrace-langchain deepagents jupyter
jupyter lab   # or: jupyter notebook
```

Then open a notebook and run all cells. To launch the dashboard the traces
stream to: `pip install deepagents-trace && agenttrace ui`.
