# Installation

LaneTrace is published on PyPI as **`lanetrace`**, which is also the import
and the CLI command. It needs Python 3.10 or later. (Up to 0.2 it was
AgentTrace, published as `deepagents-trace`: see
[Upgrading](upgrading.md#from-02-renamed-to-lanetrace).)

```bash
pip install 'lanetrace[server]'                   # the dashboard and the SDK
pip install 'lanetrace[langchain,server]'         # plus LangChain, deepagents
pip install lanetrace                             # the SDK only
```

## Extras

| Extra | Adds | Needed for |
| --- | --- | --- |
| none | `sqlalchemy`, `requests`, `click` | the tracking SDK, `lanetrace db init` |
| `server` | `fastapi`, `uvicorn[standard]`, `bcrypt`, `itsdangerous`, `websockets` | `lanetrace ui`, `lanetrace demo` |
| `langchain` | `langchain`, `langchain-core`, `httpx` | `lanetrace.langchain` |
| `postgres` | `psycopg[binary]` | a PostgreSQL database |
| `e2e` | `playwright`, `pytest-playwright` | the end-to-end tests |
| `dev` | `server` and `langchain`, plus `pytest`, `pytest-asyncio`, `pytest-mock`, `httpx` | working on LaneTrace |

Without the `server` extra, `lanetrace ui` and `lanetrace demo` stop with the
command that installs it.

## Check the installation

```bash
lanetrace --version
lanetrace demo    # three sample projects, written to ./lanetrace.db
lanetrace ui      # the dashboard, on http://127.0.0.1:3000
```

## From a source checkout

```bash
git clone https://github.com/CouLiBaLy-B/lanetrace && cd lanetrace
pip install -e "./python-server[dev]"
bun install && bun run build:ui  # builds the dashboard
```

Wheels on PyPI already contain the dashboard. A source install only has it
once `bun run build:ui` has written it to
`python-server/lanetrace/server/static/`; until then, `/` serves a
placeholder page and the API works as usual.

## Docker

One image runs the server and the dashboard, and `docker compose` adds
PostgreSQL. See [Deployment](deployment.md).

## The `deepagents-trace` package

`deepagents-trace` 0.3.0, the pre-0.3 distribution name, is now a deprecated
compatibility package: it installs `lanetrace` (its extras map to the same
`lanetrace` extras) and keeps `import agenttrace` and the `agenttrace`
command working, with a deprecation warning. New code installs and imports
`lanetrace`.

## The `agenttrace-langchain` package

`agenttrace-langchain` is now a deprecated shim over
`lanetrace[langchain]`: its imports keep working and emit a
`DeprecationWarning`. New code imports `lanetrace.langchain`; see
[Upgrading](upgrading.md#from-agenttrace-langchain-02x).
