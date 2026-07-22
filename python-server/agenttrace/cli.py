"""`agenttrace` CLI — `agenttrace ui` starts the FastAPI server + WebSocket,
no Node/Bun process required (`mlflow ui`-style, see the plan for context).

Imports of `agenttrace.server.*` are deferred to inside each command so that
`--database-url` can set `DATABASE_URL` in the environment *before* `db.py`'s
module-level SQLAlchemy engine gets created.
"""

from __future__ import annotations

import os

import click

_LOGO = r"""
    ___                    __ ______
   /   | ____ ____  ____  / //_  __/________ _________
  / /| |/ __ `/ _ \/ __ \/ __/ / / / ___/ __ `/ ___/ _ \
 / ___ / /_/ /  __/ / / / /_  / / / /  / /_/ / /__/  __/
/_/  |_\__, /\___/_/ /_/\__/ /_/ /_/   \__,_/\___/\___/
      /____/
"""

_DOCS_URL = "https://coulibaly-b.github.io/agenttrace"


def _version() -> str:
    from importlib.metadata import PackageNotFoundError, version

    for dist in ("deepagents-trace", "agenttrace"):
        try:
            return version(dist)
        except PackageNotFoundError:
            continue
    return "dev"


def _mask_db_url(url: str) -> str:
    """Hide credentials in a DB URL before printing it (scheme://user:PASS@host)."""
    if "://" not in url or "@" not in url:
        return url
    scheme, rest = url.split("://", 1)
    creds, host = rest.rsplit("@", 1)
    user = creds.split(":", 1)[0]
    return f"{scheme}://{user}:***@{host}" if ":" in creds else f"{scheme}://{rest}"


def _print_banner(host: str, port: int) -> None:
    db = os.environ.get("DATABASE_URL")
    db_display = _mask_db_url(db) if db else "sqlite (agenttrace.db)"
    base = f"http://{host}:{port}"
    click.echo(click.style(_LOGO, fg="green"))
    click.echo(click.style(f"  AgentTrace {_version()}", fg="green", bold=True))
    click.echo("  observability for AI agents\n")
    click.echo("  Running the AgentTrace web UI:")
    for label, value in (
        ("URL", base),
        ("API", f"{base}/api"),
        ("WebSocket", f"ws://{host}:{port}/ws"),
        ("Database", db_display),
        ("Docs", _DOCS_URL),
    ):
        click.echo(f"    {label + ':':11} {value}")
    click.echo("\n  Press CTRL+C to stop.\n")


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
def ui(host: str, port: int, database_url: str | None) -> None:
    """Start the AgentTrace web UI + API (and the /ws live-stream)."""
    if database_url:
        os.environ["DATABASE_URL"] = database_url

    import uvicorn

    _print_banner(host, port)
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
