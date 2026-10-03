import importlib.util

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


import os

import pytest


@pytest.fixture
def fake_uvicorn(monkeypatch):
    import uvicorn

    calls = []
    monkeypatch.setattr(uvicorn, "run", lambda *a, **k: calls.append((a, k)))
    monkeypatch.delenv("AGENTTRACE_AUTH", raising=False)
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
