import importlib.util
import os
import re

import pytest
from click.testing import CliRunner

from agenttrace import cli


def test_ui_without_server_extra_exits_with_install_hint(monkeypatch):
    real_find_spec = importlib.util.find_spec
    monkeypatch.setattr(
        importlib.util, "find_spec", lambda name, *a: None if name == "fastapi" else real_find_spec(name, *a)
    )
    result = CliRunner().invoke(cli.main, ["ui"])
    assert result.exit_code == 1
    assert "pip install 'deepagents-trace[server]'" in result.output


@pytest.fixture
def fake_uvicorn(monkeypatch):
    import uvicorn

    calls = []
    monkeypatch.setattr(uvicorn, "run", lambda *a, **k: calls.append((a, k)))
    # ui() sets these in os.environ directly: register their restore first.
    monkeypatch.setenv("AGENTTRACE_AUTH", "password")
    monkeypatch.delenv("AGENTTRACE_AUTH")
    monkeypatch.setenv("DATABASE_URL", os.environ["DATABASE_URL"])
    monkeypatch.delenv("NO_COLOR", raising=False)
    return calls


@pytest.mark.parametrize(
    "args, expected",
    [([], "none"), (["--host", "0.0.0.0"], "password"), (["--auth", "password"], "password")],
)
def test_ui_auth_defaults(fake_uvicorn, monkeypatch, args, expected):
    result = CliRunner().invoke(cli.main, ["ui", *args])
    assert result.exit_code == 0, result.output
    assert os.environ["AGENTTRACE_AUTH"] == expected
    assert len(fake_uvicorn) == 1


def test_ui_warns_on_public_host_without_auth(fake_uvicorn):
    result = CliRunner().invoke(cli.main, ["ui", "--host", "0.0.0.0", "--auth", "none"])
    assert result.exit_code == 0
    assert "WARNING" in result.output
    assert "AGENTTRACE_ALLOWED_HOSTS" in result.output


def test_db_init_works_without_server_extra(monkeypatch, tmp_path):
    import sys

    real_find_spec = importlib.util.find_spec
    monkeypatch.setattr(
        importlib.util, "find_spec", lambda name, *a: None if name == "fastapi" else real_find_spec(name, *a)
    )
    for mod in [m for m in sys.modules if m == "fastapi" or m.startswith(("fastapi.", "agenttrace.server"))]:
        monkeypatch.delitem(sys.modules, mod)
    monkeypatch.setitem(sys.modules, "fastapi", None)  # `import fastapi` -> ImportError
    url = f"sqlite:///{tmp_path}/init.db"
    result = CliRunner().invoke(cli.main, ["db", "init", "--database-url", url])
    assert result.exit_code == 0, result.output
    from sqlalchemy import inspect

    from agenttrace.store.db import get_engine

    assert "runs" in inspect(get_engine(url)).get_table_names()


def test_ui_honours_agenttrace_auth_env_on_localhost(fake_uvicorn, monkeypatch):
    monkeypatch.setenv("AGENTTRACE_AUTH", "password")
    result = CliRunner().invoke(cli.main, ["ui"])
    assert result.exit_code == 0, result.output
    assert os.environ["AGENTTRACE_AUTH"] == "password"
    assert re.search(r"^  Auth +password ", result.output, re.MULTILINE)


def test_ui_auth_flag_overrides_env(fake_uvicorn, monkeypatch):
    monkeypatch.setenv("AGENTTRACE_AUTH", "password")
    result = CliRunner().invoke(cli.main, ["ui", "--auth", "none"])
    assert result.exit_code == 0, result.output
    assert os.environ["AGENTTRACE_AUTH"] == "none"


def test_ui_warns_on_public_host_with_env_auth_none(fake_uvicorn, monkeypatch):
    monkeypatch.setenv("AGENTTRACE_AUTH", "none")
    result = CliRunner().invoke(cli.main, ["ui", "--host", "0.0.0.0"])
    assert result.exit_code == 0, result.output
    assert os.environ["AGENTTRACE_AUTH"] == "none"
    assert "WARNING" in result.output


def _banner_row(output, label):
    match = re.search(rf"^  {label} +(.+)$", output, re.MULTILINE)
    assert match, output
    return match.group(1)


def test_ui_banner_shows_version_url_auth_database_and_tracking_hint(fake_uvicorn):
    from importlib.metadata import version

    result = CliRunner().invoke(cli.main, ["ui", "--port", "3210", "--database-url", "sqlite:////srv/at/banner.db"])
    assert result.exit_code == 0, result.output
    assert f"AgentTrace {version('deepagents-trace')}" in result.output
    assert _banner_row(result.output, "Dashboard") == "http://127.0.0.1:3210"
    assert _banner_row(result.output, "Auth").startswith("none ")
    assert _banner_row(result.output, "Database") == "sqlite:////srv/at/banner.db"
    assert _banner_row(result.output, "Tracking") == "AGENTTRACE_TRACKING_URI=http://127.0.0.1:3210"
    assert _banner_row(result.output, "Docs") == cli.DOCS_URL
    assert fake_uvicorn[0][1]["port"] == 3210


def test_ui_banner_resolves_a_relative_sqlite_file(fake_uvicorn, tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    result = CliRunner().invoke(cli.main, ["ui", "--database-url", "sqlite:///./agenttrace.db"])
    assert result.exit_code == 0, result.output
    expected = f"sqlite:///./agenttrace.db  ({(tmp_path / 'agenttrace.db').resolve()})"
    assert _banner_row(result.output, "Database") == expected


def test_ui_banner_on_all_interfaces_in_password_mode(fake_uvicorn):
    result = CliRunner().invoke(cli.main, ["ui", "--host", "0.0.0.0", "--port", "8080"])
    assert result.exit_code == 0, result.output
    # A browser can't open 0.0.0.0; remote agents need this machine's address.
    assert _banner_row(result.output, "Dashboard") == "http://localhost:8080"
    assert _banner_row(result.output, "Auth").startswith("password ")
    assert _banner_row(result.output, "Tracking") == "AGENTTRACE_TRACKING_URI=http://<server-address>:8080"
    assert "AGENTTRACE_KEY=atr_" in result.output


def test_ui_banner_masks_the_database_password(fake_uvicorn):
    url = "postgresql+psycopg://agent:s3cr3t-pw@db.internal:5432/traces"
    result = CliRunner().invoke(cli.main, ["ui", "--database-url", url])
    assert result.exit_code == 0, result.output
    assert _banner_row(result.output, "Database") == "postgresql+psycopg://agent:***@db.internal:5432/traces"
    assert "s3cr3t-pw" not in result.output
    assert os.environ["DATABASE_URL"] == url  # the server itself still gets the real URL


def test_ui_banner_masks_a_password_from_database_url_env(fake_uvicorn, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://agent:from-env@db/traces")
    result = CliRunner().invoke(cli.main, ["ui"])
    assert result.exit_code == 0, result.output
    assert _banner_row(result.output, "Database") == "postgresql://agent:***@db/traces"
    assert "from-env" not in result.output


@pytest.mark.parametrize(
    "url, masked",
    [
        ("postgresql://user:secret@host/db", "postgresql://user:***@host/db"),
        ("postgresql://user:p@ss@host:5432/db", "postgresql://user:***@host:5432/db"),
        ("postgresql://user:a/b?c@host/db", "postgresql://user:***@host/db"),
        ("postgresql://:secret@host/db", "postgresql://:***@host/db"),
        (
            "postgresql://host/db?user=u&password=secret&sslmode=require",
            "postgresql://host/db?user=u&password=***&sslmode=require",
        ),
        ("postgresql://u@host/db?sslpassword=secret", "postgresql://u@host/db?sslpassword=***"),
        ("postgresql://user@host:5432/db", "postgresql://user@host:5432/db"),
        ("sqlite:///./agenttrace.db", "sqlite:///./agenttrace.db"),
        ("sqlite:////home/me/p@th/agenttrace.db", "sqlite:////home/me/p@th/agenttrace.db"),
    ],
)
def test_mask_db_url(url, masked):
    assert cli.mask_db_url(url) == masked


def test_ui_banner_is_plain_text_off_a_terminal_or_with_no_color(fake_uvicorn):
    plain = CliRunner().invoke(cli.main, ["ui"])  # CliRunner's stdout is not a terminal
    assert plain.exit_code == 0, plain.output
    assert "\x1b[" not in plain.output
    colored = CliRunner().invoke(cli.main, ["ui"], color=True)  # as if it were one
    assert "\x1b[" in colored.output
    no_color = CliRunner().invoke(cli.main, ["ui"], color=True, env={"NO_COLOR": "1"})
    assert "\x1b[" not in no_color.output
    assert fake_uvicorn[-1][1]["use_colors"] is False  # uvicorn's own log lines too


def test_demo_masks_the_database_password(monkeypatch):
    import contextlib

    from agenttrace.server import demo as server_demo
    from agenttrace.store import db as store_db
    from agenttrace.store import local

    monkeypatch.setattr(store_db, "init_db", lambda url: None)
    monkeypatch.setattr(store_db, "get_sessionmaker", lambda url: contextlib.nullcontext)
    monkeypatch.setattr(local, "get_or_create_local_user", lambda db: None)
    monkeypatch.setattr(server_demo, "seed_demo", lambda db, user: 3)
    result = CliRunner().invoke(cli.main, ["demo", "--database-url", "postgresql://agent:s3cr3t@db/traces"])
    assert result.exit_code == 0, result.output
    assert "postgresql://agent:***@db/traces" in result.output
    assert "s3cr3t" not in result.output
