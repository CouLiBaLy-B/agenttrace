"""`lanetrace` CLI — `lanetrace ui` starts the FastAPI server + WebSocket,
no Node/Bun process required (`mlflow ui`-style, see the plan for context).

Imports of `lanetrace.server.*` are deferred to inside each command so that
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
from click.core import ParameterSource

from . import _env

DOCS_URL = "https://coulibaly-b.github.io/lanetrace/"

_LOGO = r"""
    __                   ______
   / /   ____ _____  ___/_  __/________ _________
  / /   / __ `/ __ \/ _ \/ / / ___/ __ `/ ___/ _ \
 / /___/ /_/ / / / /  __/ / / /  / /_/ / /__/  __/
/_____/\__,_/_/ /_/\___/_/ /_/   \__,_/\___/\___/
"""

# Credential query parameters (?password=..., &sslpassword=..., ?authToken=...,
# ?motherduck_token=...). The value runs to the next "&": SQLAlchemy keeps a
# "#" inside it.
_QUERY_PASSWORD = re.compile(
    r"(?i)(?P<key>[?&][^=&]*(?:password|passwd|pwd|secret|token|credential)[^=&]*=)[^&]*"
)
# Inline key=value passwords: libpq keyword DSNs ("host=db password=..."),
# PWD=... inside an ODBC connect string, URL-encoded or not.
_INLINE_PASSWORD = re.compile(r"(?i)(?P<key>(?:password|passwd|pwd)\s*(?:=|%3D)\s*)(?:'[^']*'|[^\s;&]*)")
# SQLite URLs that never carry credentials (sqlite+pysqlcipher does: masked).
_PLAIN_SQLITE = {"sqlite", "sqlite+pysqlite", "sqlite+aiosqlite"}


def _mask_userinfo(text: str) -> str:
    """Hide everything before the LAST "@" when it holds a ":" (user and
    password together). A stray "@" later in the URL hides more than needed,
    never less."""
    userinfo, at, rest = text.rpartition("@")
    return f"***@{rest}" if at and ":" in userinfo else text


def mask_db_url(url: str) -> str:
    """`url` safe to print: `user:password@` becomes `***@` and any password
    query parameter `***`.

    Deliberately not parsed with SQLAlchemy: an unencoded "@" in a password
    makes its parse cut the password in two, and its masked rendering then
    prints the second half. Deliberately wide too: the user name is hidden
    with the password. A URL without a password is printed as is."""
    text = url.strip()
    scheme, sep, rest = text.partition("://")
    if sep and scheme.lower() in _PLAIN_SQLITE:
        return text
    if sep:
        masked = f"{scheme}://" + _QUERY_PASSWORD.sub(r"\g<key>***", _mask_userinfo(rest))
    else:
        masked = _mask_userinfo(text)
    return _INLINE_PASSWORD.sub(r"\g<key>***", masked)


def _require_server_extra() -> None:
    if importlib.util.find_spec("fastapi") is None or importlib.util.find_spec("uvicorn") is None:
        click.echo("[LaneTrace] The server isn't installed: pip install 'lanetrace[server]'", err=True)
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
        return importlib.metadata.version("lanetrace")
    except importlib.metadata.PackageNotFoundError:  # imported from a source tree
        from . import __version__

        return __version__


def _http_url(host: str, port: int) -> str:
    return f"http://[{host}]:{port}" if ":" in host else f"http://{host}:{port}"


def _sqlite_file(url: str) -> Optional[Path]:
    """Absolute path of a relative SQLite file URL: it is relative to the
    server's working directory, and the SDK's default `./lanetrace.db` to the
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


def _auth_none_warning(host: str) -> str:
    """`--auth none` on a non-loopback address: say who can reach it, and the
    exact LANETRACE_ALLOWED_HOSTS value that lets the Host guard accept it."""
    warning = f"[LaneTrace] WARNING: auth none on {host} — anyone who can reach this port can read and write traces."
    allowed = _env.getenv("ALLOWED_HOSTS", "").strip()
    if allowed:
        return f"{warning} Host names accepted besides loopback: LANETRACE_ALLOWED_HOSTS={allowed}"
    name = "<server-address>" if host in WILDCARD_HOSTS else host
    return f"{warning} Only loopback Host names are accepted: to open it as {name}, set LANETRACE_ALLOWED_HOSTS={name}"


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
        key_hint = "LANETRACE_KEY=atr_...  (a project key, from the Integration page)"
    rows = [
        ("Dashboard", _http_url("localhost" if wildcard else host, port)),
        ("Auth", auth_text),
        ("Database", database),
        ("Tracking", "LANETRACE_TRACKING_URI=" + _http_url("<server-address>" if wildcard else host, port)),
        ("", key_hint),
        ("Docs", DOCS_URL),
    ]

    echo(_LOGO, fg="green")
    echo(f"  LaneTrace {_version()}", fg="green", bold=True)
    echo("  observability for AI agents")
    echo()
    for label, value in rows:
        echo(f"  {label:<11} {value}")
    echo()


@click.group()
@click.version_option(package_name="lanetrace")
def main() -> None:
    """LaneTrace - observability for AI agents."""


@main.command()
@click.option("--host", default="127.0.0.1", show_default=True, help="Bind address.")
@click.option("--port", default=3000, show_default=True, type=int, help="Port to serve on.")
@click.option(
    "--database-url",
    envvar="DATABASE_URL",
    default=None,
    help="SQLAlchemy database URL. Defaults to a local SQLite file (lanetrace.db) if unset.",
)
@click.option(
    "--auth",
    type=click.Choice(["none", "password"]),
    envvar=_env.names("AUTH"),
    default=None,
    help="none: no login/API key (default on localhost). password: accounts + project keys (default otherwise). "
    "Env: LANETRACE_AUTH (or the deprecated AGENTTRACE_AUTH).",
)
def ui(host: str, port: int, database_url: str | None, auth: str | None) -> None:
    """Start the LaneTrace web UI + API (and the /ws live-stream).

    With --auth none, only loopback Host/Origin names are accepted (DNS
    rebinding / CSRF guard); set LANETRACE_ALLOWED_HOSTS=name1,name2 to allow
    extra hostnames, e.g. behind a reverse proxy.
    """
    _require_server_extra()
    if database_url:
        os.environ["DATABASE_URL"] = database_url
    notices = []
    if auth is not None and click.get_current_context().get_parameter_source("auth") == ParameterSource.ENVIRONMENT:
        _env.warn_if_legacy("AUTH")  # click read AGENTTRACE_AUTH: say so, like every other fallback
    if auth is None:
        auth = "none" if host in LOOPBACK_HOSTS else "password"
    elif auth == "none" and host not in LOOPBACK_HOSTS:
        notices.append(_auth_none_warning(host))
    os.environ["LANETRACE_AUTH"] = auth
    if auth == "password" and not _env.getenv("SECRET"):
        from .server.security import REQUIRED_SECRET_MESSAGE, missing_required_secret

        if missing_required_secret():
            click.echo(f"[LaneTrace] ERROR: {REQUIRED_SECRET_MESSAGE}", err=True)
            sys.exit(1)
        notices.append(
            "[LaneTrace] WARNING: LANETRACE_SECRET not set — using a random secret; sign-ins won't survive a restart"
        )

    import uvicorn

    from .store.db import database_url as default_database_url

    _print_banner(host, port, auth, database_url or default_database_url())
    for notice in notices:
        click.echo(click.style(notice, fg="yellow"), color=_color())
    uvicorn.run("lanetrace.server.app:app", host=host, port=port, log_level="info", use_colors=_color())


@main.command()
@click.option("--database-url", envvar="DATABASE_URL", default=None, help="Target database (default: ./lanetrace.db).")
def demo(database_url: str | None) -> None:
    """Load three demo projects for the local (no-auth) user.

    No-op if that user already has projects. In --auth password mode, signed-in
    users load demo data from Settings -> Demo data -> "Load demo projects" instead.
    """
    _require_server_extra()
    from .server.demo import seed_demo
    from .store import db as store_db
    from .store.local import get_or_create_local_user

    url = database_url or store_db.database_url()
    store_db.init_db(url)
    with store_db.get_sessionmaker(url)() as db:
        n = seed_demo(db, get_or_create_local_user(db))
    if n:
        click.echo(
            f"[LaneTrace] Loaded {n} demo projects into {mask_db_url(url)}. Run `lanetrace ui` to explore them."
        )
    else:
        click.echo(f"[LaneTrace] {mask_db_url(url)} already has projects for the local user — nothing to do.")


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
    click.echo("[LaneTrace] Database schema is up to date.")


if __name__ == "__main__":
    main()
