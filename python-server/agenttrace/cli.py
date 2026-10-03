"""`agenttrace` CLI — `agenttrace ui` starts the FastAPI server + WebSocket,
no Node/Bun process required (`mlflow ui`-style, see the plan for context).

Imports of `agenttrace.server.*` are deferred to inside each command so that
`--database-url` can set `DATABASE_URL` in the environment *before* `db.py`'s
module-level SQLAlchemy engine gets created.
"""

from __future__ import annotations

import importlib.util
import os
import sys

import click


def _require_server_extra() -> None:
    if importlib.util.find_spec("fastapi") is None or importlib.util.find_spec("uvicorn") is None:
        click.echo("[AgentTrace] The server isn't installed: pip install 'deepagents-trace[server]'", err=True)
        sys.exit(1)


LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}


@click.group()
@click.version_option(package_name="agenttrace")
def main() -> None:
    """AgentTrace - observability for AI agents."""


@main.command()
@click.option("--host", default="127.0.0.1", show_default=True, help="Bind address.")
@click.option("--port", default=3000, show_default=True, type=int, help="Port to serve on.")
@click.option(
    "--database-url",
    envvar="DATABASE_URL",
    default=None,
    help="SQLAlchemy database URL. Defaults to a local SQLite file (agenttrace.db) if unset.",
)
@click.option(
    "--auth",
    type=click.Choice(["none", "password"]),
    default=None,
    help="none: no login/API key (default on localhost). password: accounts + project keys (default otherwise).",
)
def ui(host: str, port: int, database_url: str | None, auth: str | None) -> None:
    """Start the AgentTrace web UI + API (and the /ws live-stream)."""
    _require_server_extra()
    if database_url:
        os.environ["DATABASE_URL"] = database_url
    if auth is None:
        auth = "none" if host in LOOPBACK_HOSTS else "password"
    elif auth == "none" and host not in LOOPBACK_HOSTS:
        click.echo(
            f"[AgentTrace] WARNING: --auth none on {host} — anyone who can reach this port can read and write traces."
        )
    os.environ["AGENTTRACE_AUTH"] = auth

    import uvicorn

    click.echo(f"[AgentTrace] Starting at http://{host}:{port} (auth: {auth})")
    uvicorn.run("agenttrace.server.app:app", host=host, port=port, log_level="info")


@main.group()
def db() -> None:
    """Database schema management (schema-push style, no migration history)."""


@db.command("init")
@click.option("--database-url", envvar="DATABASE_URL", default=None)
def db_init(database_url: str | None) -> None:
    """Create all tables if they don't already exist."""
    if database_url:
        os.environ["DATABASE_URL"] = database_url

    from .server.db import init_db

    init_db()
    click.echo("[AgentTrace] Database schema is up to date.")


if __name__ == "__main__":
    main()
