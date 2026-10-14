# Installation

AgentTrace is published on PyPI as **`deepagents-trace`**. The import, the CLI
command and the product are all called `agenttrace` (that name was already
taken on PyPI by an unrelated project). It needs Python 3.10 or later.

```bash
pip install 'deepagents-trace[server]'            # the dashboard and the SDK
pip install 'deepagents-trace[langchain,server]'  # plus LangChain, deepagents
pip install deepagents-trace                      # the SDK only
```

## Extras

| Extra | Adds | Needed for |
| --- | --- | --- |
| none | `sqlalchemy`, `requests`, `click` | the tracking SDK, `agenttrace db init` |
| `server` | `fastapi`, `uvicorn[standard]`, `bcrypt`, `itsdangerous`, `websockets` | `agenttrace ui`, `agenttrace demo` |
| `langchain` | `langchain`, `langchain-core`, `httpx` | `agenttrace.langchain` |
| `postgres` | `psycopg[binary]` | a PostgreSQL database |
| `e2e` | `playwright`, `pytest-playwright` | the end-to-end tests |
| `dev` | `server` and `langchain`, plus `pytest`, `pytest-asyncio`, `pytest-mock`, `httpx` | working on AgentTrace |

Without the `server` extra, `agenttrace ui` and `agenttrace demo` stop with the
command that installs it.

## Check the installation

```bash
agenttrace --version
agenttrace demo   # three sample projects, written to ./agenttrace.db
agenttrace ui     # the dashboard, on http://127.0.0.1:3000
```

## From a source checkout

```bash
git clone https://github.com/CouLiBaLy-B/agenttrace && cd agenttrace
pip install -e "./python-server[dev]"
bun install && bun run build:ui  # builds the dashboard
```

Wheels on PyPI already contain the dashboard. A source install only has it
once `bun run build:ui` has written it to
`python-server/agenttrace/server/static/`; until then, `/` serves a
placeholder page and the API works as usual.

## Docker

One image runs the server and the dashboard, and `docker compose` adds
PostgreSQL. See [Deployment](deployment.md).

## The `agenttrace-langchain` package

`agenttrace-langchain` is now a deprecated shim over
`deepagents-trace[langchain]`: its imports keep working and emit a
`DeprecationWarning`. New code imports `agenttrace.langchain`; see
[Upgrading](upgrading.md#from-agenttrace-langchain-02x).
