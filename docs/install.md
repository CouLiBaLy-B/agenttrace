# Installation

AgentTrace has two independently installable packages. Install the dashboard
where you want to view traces, and the client wherever your agent runs (often
the same machine in development).

## Dashboard — `deepagents-trace`

```bash
pip install deepagents-trace
agenttrace ui
```

`agenttrace ui` starts the FastAPI server, the API, and the live-stream
WebSocket, and serves the pre-built frontend — no Node/Bun process required.
See the [CLI reference](cli.md) for options (`--host`, `--port`,
`--database-url`).

Requirements: Python 3.10+. By default it uses a local SQLite file
(`agenttrace.db`); point it at Postgres with `--database-url` /
`DATABASE_URL` for shared/production use (see [Deployment](deployment.md)).

## Client — `agenttrace-langchain`

```bash
pip install agenttrace-langchain
```

Requirements: Python 3.10+, `langchain>=1.0`. Works with deepagents and
LangChain's `create_agent`.

For local development against a checkout:

```bash
pip install -e integrations/agenttrace-langchain
```

## Verify

1. Start the dashboard: `agenttrace ui` → open the printed URL.
2. Sign up, create a project, and copy its API key (prefix `atr_`) from the
   **Integration** tab.
3. Point your agent at it and run — see [Quickstart](quickstart.md).
