"""`agenttrace` CLI — `agenttrace ui` starts the FastAPI server + WebSocket,
no Node/Bun process required (`mlflow ui`-style, see the plan for context).

Imports of `agenttrace.server.*` are deferred to inside each command so that
`--database-url` can set `DATABASE_URL` in the environment *before* `db.py`'s
module-level SQLAlchemy engine gets created.
"""

from __future__ import annotations

import importlib.metadata
import importlib.util
import os
import re
import sys
from pathlib import Path
from typing import Optional

import click

DOCS_URL = "https://coulibaly-b.github.io/agenttrace/"

_LOGO = r"""
    ___                    __ ______
   /   | ____ ____  ____  / //_  __/________ _________
  / /| |/ __ `/ _ \/ __ \/ __/ / / / ___/ __ `/ ___/ _ \
 / ___ / /_/ /  __/ / / / /_  / / / /  / /_/ / /__/  __/
/_/  |_\__, /\___/_/ /_/\__/ /_/ /_/   \__,_/\___/\___/
      /____/
"""

# scheme://user:PASSWORD@host — the password runs to the LAST "@", so a
# password with an unencoded "@" or "/" is still masked whole (a stray "@"
# later in the URL can over-mask, never under-mask).
_URL_PASSWORD = re.compile(r"^(?P<head>[A-Za-z][A-Za-z0-9+.\-]*://[^:/?#@]*):.*@")
# libpq-style query parameters: ?password=..., &sslpassword=...
_QUERY_PASSWORD = re.compile(r"(?i)(?P<key>[?&][^=&#]*(?:password|passwd|pwd)=)[^&#]*")


def mask_db_url(url: str) -> str:
    """`url` with its password replaced by `***` (the `user:password@` part
    and any password query parameter), safe to print."""
    masked = _URL_PASSWORD.sub(r"\g<head>:***@", url, count=1)
    return _QUERY_PASSWORD.sub(r"\g<key>***", masked)


def _require_server_extra() -> None:
    if importlib.util.find_spec("fastapi") is None or importlib.util.find_spec("uvicorn") is None:
        click.echo("[AgentTrace] The server isn't installed: pip install 'deepagents-trace[server]'", err=True)
        sys.exit(1)


LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}
# Bind-all addresses: no browser opens them, and in --auth none mode the Host
# guard only accepts loopback names, so the banner shows localhost instead.
WILDCARD_HOSTS = {"0.0.0.0", "::", ""}


def _color() -> Optional[bool]:
    """`color=` for click.echo / `use_colors=` for uvicorn: off when NO_COLOR
    is set (https://no-color.org), else auto (styled only on a terminal)."""
    return False if os.environ.get("NO_COLOR") else None


def _version() -> str:
    try:
        return importlib.metadata.version("deepagents-trace")
    except importlib.metadata.PackageNotFoundError:  # imported from a source tree
        from . import __version__

        return __version__


def _http_url(host: str, port: int) -> str:
    return f"http://[{host}]:{port}" if ":" in host else f"http://{host}:{port}"


def _sqlite_file(url: str) -> Optional[Path]:
    """Absolute path of a relative SQLite file URL: it is relative to the
    server's working directory, and the SDK's default `./agenttrace.db` to the
    agent's, so printing it shows whether both use the same file."""
    if not url.startswith("sqlite"):
        return None
    from sqlalchemy.engine import make_url
    from sqlalchemy.exc import ArgumentError

    try:
        database = make_url(url).database
    except ArgumentError:
        return None
    if not database or database == ":memory:" or database.startswith("file:") or Path(database).is_absolute():
        return None
    return Path(database).resolve()


def _print_banner(host: str, port: int, auth: str, database_url: str) -> None:
    """Startup banner, airflow-style. Plain text off a terminal (click strips
    the ANSI codes) or when NO_COLOR is set."""
    color = _color()

    def echo(text: str = "", **style) -> None:
        click.echo(click.style(text, **style) if style else text, color=color)

    wildcard = host in WILDCARD_HOSTS
    database = mask_db_url(database_url)
    sqlite_file = _sqlite_file(database_url)
    if sqlite_file is not None:
        database += f"  ({sqlite_file})"
    if auth == "none":
        auth_text = "none (no login, no API key)"
        key_hint = "set it where your agents run to send their traces here"
    else:
        auth_text = "password (accounts; agents send a project API key)"
        key_hint = "AGENTTRACE_KEY=atr_...  (a project key, from the Integration page)"
    rows = [
        ("Dashboard", _http_url("localhost" if wildcard else host, port)),
        ("Auth", auth_text),
        ("Database", database),
        ("Tracking", "AGENTTRACE_TRACKING_URI=" + _http_url("<server-address>" if wildcard else host, port)),
        ("", key_hint),
        ("Docs", DOCS_URL),
    ]

    echo(_LOGO, fg="green")
    echo(f"  AgentTrace {_version()}", fg="green", bold=True)
    echo("  observability for AI agents")
    echo()
    for label, value in rows:
        echo(f"  {label:<11} {value}")
    echo()


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
    envvar="AGENTTRACE_AUTH",
    default=None,
    help="none: no login/API key (default on localhost). password: accounts + project keys (default otherwise). "
    "Env: AGENTTRACE_AUTH.",
)
def ui(host: str, port: int, database_url: str | None, auth: str | None) -> None:
    """Start the AgentTrace web UI + API (and the /ws live-stream).

    With --auth none, only loopback Host/Origin names are accepted (DNS
    rebinding / CSRF guard); set AGENTTRACE_ALLOWED_HOSTS=name1,name2 to allow
    extra hostnames, e.g. behind a reverse proxy.
    """
    _require_server_extra()
    if database_url:
        os.environ["DATABASE_URL"] = database_url
    notices = []
    if auth is None:
        auth = "none" if host in LOOPBACK_HOSTS else "password"
    elif auth == "none" and host not in LOOPBACK_HOSTS:
        notices.append(
            f"[AgentTrace] WARNING: auth none on {host} — anyone who can reach this port can read and write traces. "
            "Only loopback Host names are accepted unless AGENTTRACE_ALLOWED_HOSTS lists the public hostname(s)."
        )
    os.environ["AGENTTRACE_AUTH"] = auth
    if auth == "password" and not os.getenv("AGENTTRACE_SECRET"):
        notices.append(
            "[AgentTrace] WARNING: AGENTTRACE_SECRET not set — using a random secret; sign-ins won't survive a restart"
        )

    import uvicorn

    from .store.db import DEFAULT_SQLITE_URL

    _print_banner(host, port, auth, database_url or DEFAULT_SQLITE_URL)
    for notice in notices:
        click.echo(click.style(notice, fg="yellow"), color=_color())
    uvicorn.run("agenttrace.server.app:app", host=host, port=port, log_level="info", use_colors=_color())


@main.command()
@click.option("--database-url", envvar="DATABASE_URL", default=None, help="Target database (default: ./agenttrace.db).")
def demo(database_url: str | None) -> None:
    """Load three demo projects for the local (no-auth) user.

    No-op if that user already has projects. In --auth password mode, signed-in
    users load demo data from Settings -> Demo data -> "Load demo projects" instead.
    """
    _require_server_extra()
    from .server.demo import seed_demo
    from .store import db as store_db
    from .store.local import get_or_create_local_user

    url = database_url or store_db.DEFAULT_SQLITE_URL
    store_db.init_db(url)
    with store_db.get_sessionmaker(url)() as db:
        n = seed_demo(db, get_or_create_local_user(db))
    if n:
        click.echo(
            f"[AgentTrace] Loaded {n} demo projects into {mask_db_url(url)}. Run `agenttrace ui` to explore them."
        )
    else:
        click.echo(f"[AgentTrace] {mask_db_url(url)} already has projects for the local user — nothing to do.")


@main.group()
def db() -> None:
    """Database schema management (schema-push style, no migration history)."""


@db.command("init")
@click.option("--database-url", envvar="DATABASE_URL", default=None)
def db_init(database_url: str | None) -> None:
    """Create all tables if they don't already exist."""
    # store.db only needs SQLAlchemy, so this works without the [server] extra.
    from .store.db import database_url as default_database_url
    from .store.db import init_db

    init_db(database_url or default_database_url())
    click.echo("[AgentTrace] Database schema is up to date.")


if __name__ == "__main__":
    main()
