"""AgentTrace -> LaneTrace (0.3): the old environment variable names, the old
default database file and the old class names keep working."""

import logging
import warnings

import pytest
from click.testing import CliRunner

from lanetrace import _env, cli
from lanetrace.store import db as store_db
from lanetrace.tracking import _uri


@pytest.fixture(autouse=True)
def reset(monkeypatch):
    for name in ("TRACKING_URI", "URL", "KEY", "PROJECT", "AUTH", "ALLOWED_HOSTS"):
        for var in _env.names(name):
            monkeypatch.delenv(var, raising=False)
    _env._reset_for_tests()
    _uri.set_tracking_uri(None)
    yield
    _env._reset_for_tests()


def test_new_name_wins_without_a_warning(monkeypatch):
    monkeypatch.setenv("LANETRACE_PROJECT", "new")
    monkeypatch.setenv("AGENTTRACE_PROJECT", "old")
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        assert _env.getenv("PROJECT") == "new"


def test_old_name_is_a_fallback_with_one_warning_per_process(monkeypatch, caplog):
    monkeypatch.setenv("AGENTTRACE_PROJECT", "old")
    monkeypatch.setenv("AGENTTRACE_KEY", "atr_old")
    with caplog.at_level(logging.WARNING, logger="lanetrace"):
        with pytest.warns(DeprecationWarning, match="AGENTTRACE_PROJECT -> LANETRACE_PROJECT") as record:
            assert _env.getenv("PROJECT") == "old"
            assert _env.getenv("KEY") == "atr_old"
            assert _env.getenv("PROJECT") == "old"
    assert len([w for w in record if issubclass(w.category, DeprecationWarning)]) == 1
    [line] = [r.getMessage() for r in caplog.records if "deprecated" in r.getMessage()]
    assert "AGENTTRACE_KEY -> LANETRACE_KEY" in line


def test_unset_returns_the_default():
    assert _env.getenv("PROJECT") is None
    assert _env.getenv("ALLOWED_HOSTS", "") == ""


def test_tracking_uri_reads_the_old_name(monkeypatch):
    monkeypatch.setenv("AGENTTRACE_TRACKING_URI", "http://old:3000")
    with pytest.warns(DeprecationWarning):
        assert _uri.get_tracking_uri() == "http://old:3000"


def test_project_reads_the_old_name(monkeypatch):
    from lanetrace.tracking import fluent

    monkeypatch.setattr(fluent, "_project", None)
    monkeypatch.setenv("AGENTTRACE_PROJECT", "legacy-project")
    with pytest.warns(DeprecationWarning):
        assert fluent.get_project() == "legacy-project"


@pytest.fixture
def no_database_url(tmp_path, monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.chdir(tmp_path)
    return tmp_path


def test_default_database_is_lanetrace_db(no_database_url):
    assert _env.default_sqlite_url() == "sqlite:///./lanetrace.db"
    assert store_db.database_url() == "sqlite:///./lanetrace.db"
    assert _uri.get_tracking_uri() == "sqlite:///./lanetrace.db"


def test_an_existing_agenttrace_db_is_used_and_logged_once(no_database_url, caplog):
    (no_database_url / "agenttrace.db").touch()
    with caplog.at_level(logging.WARNING, logger="lanetrace"):
        assert store_db.database_url() == "sqlite:///./agenttrace.db"
        assert _uri.get_tracking_uri() == "sqlite:///./agenttrace.db"
    assert len([r for r in caplog.records if "agenttrace.db" in r.getMessage()]) == 1
    assert "rename it to ./lanetrace.db" in caplog.text


def test_lanetrace_db_wins_when_both_exist(no_database_url):
    (no_database_url / "agenttrace.db").touch()
    (no_database_url / "lanetrace.db").touch()
    assert store_db.database_url() == "sqlite:///./lanetrace.db"


@pytest.fixture
def fake_uvicorn(monkeypatch):
    import uvicorn

    calls = []
    monkeypatch.setattr(uvicorn, "run", lambda *a, **k: calls.append((a, k)))
    monkeypatch.setenv("LANETRACE_AUTH", "x")  # ui() writes it: restore afterwards
    monkeypatch.delenv("LANETRACE_AUTH")
    return calls


def test_ui_auth_option_reads_the_old_variable(fake_uvicorn, monkeypatch):
    import os

    monkeypatch.setenv("AGENTTRACE_AUTH", "password")
    result = CliRunner().invoke(cli.main, ["ui"])
    assert result.exit_code == 0, result.output
    assert os.environ["LANETRACE_AUTH"] == "password"


def test_ui_auth_option_prefers_the_new_variable(fake_uvicorn, monkeypatch):
    import os

    monkeypatch.setenv("AGENTTRACE_AUTH", "password")
    monkeypatch.setenv("LANETRACE_AUTH", "none")
    result = CliRunner().invoke(cli.main, ["ui"])
    assert result.exit_code == 0, result.output
    assert os.environ["LANETRACE_AUTH"] == "none"


def test_ui_defaults_to_an_existing_agenttrace_db(fake_uvicorn, no_database_url):
    (no_database_url / "agenttrace.db").touch()
    result = CliRunner().invoke(cli.main, ["ui"])
    assert result.exit_code == 0, result.output
    assert "sqlite:///./agenttrace.db" in result.output


def test_ui_defaults_to_lanetrace_db(fake_uvicorn, no_database_url):
    result = CliRunner().invoke(cli.main, ["ui"])
    assert result.exit_code == 0, result.output
    assert "sqlite:///./lanetrace.db" in result.output


def test_demo_defaults_to_an_existing_agenttrace_db(no_database_url):
    store_db.init_db("sqlite:///./agenttrace.db")
    result = CliRunner().invoke(cli.main, ["demo"])
    assert result.exit_code == 0, result.output
    assert "into sqlite:///./agenttrace.db" in result.output
    assert not (no_database_url / "lanetrace.db").exists()


def test_demo_defaults_to_lanetrace_db(no_database_url):
    result = CliRunner().invoke(cli.main, ["demo"])
    assert result.exit_code == 0, result.output
    assert "into sqlite:///./lanetrace.db" in result.output
    assert (no_database_url / "lanetrace.db").exists()


def test_session_cookie_is_lanetrace_session():
    from fastapi.testclient import TestClient

    from lanetrace.server.app import app
    from lanetrace.server.security import SESSION_COOKIE_NAME

    assert SESSION_COOKIE_NAME == "lanetrace_session"
    with TestClient(app) as client:
        resp = client.post(
            "/api/auth/signup", json={"email": "cookie@example.com", "password": "secret123", "name": "C"}
        )
        assert resp.status_code == 201, resp.text
        assert "lanetrace_session" in resp.cookies


def test_old_class_names_are_aliases():
    import lanetrace
    from lanetrace.tracking.async_run import AsyncAgentTraceRun, AsyncLaneTraceRun
    from lanetrace.tracking.http import AgentTraceRun, LaneTraceRun

    assert lanetrace.AgentTraceClient is lanetrace.LaneTraceClient
    assert "AgentTraceClient" in lanetrace.__all__
    assert AsyncAgentTraceRun is AsyncLaneTraceRun and AgentTraceRun is LaneTraceRun


def test_old_langchain_class_names_are_aliases():
    lc = pytest.importorskip("lanetrace.langchain")
    assert lc.AgentTraceMiddleware is lc.LaneTraceMiddleware
    assert lc.AgentTraceCallbackHandler is lc.LaneTraceCallbackHandler
    assert lc.AsyncAgentTraceCallbackHandler is lc.AsyncLaneTraceCallbackHandler
    assert {"AgentTraceMiddleware", "AgentTraceCallbackHandler", "AsyncAgentTraceCallbackHandler"} <= set(lc.__all__)


def test_an_empty_new_variable_falls_back_to_the_old_one(monkeypatch):
    monkeypatch.setenv("LANETRACE_PROJECT", "")
    monkeypatch.setenv("AGENTTRACE_PROJECT", "old")
    with pytest.warns(DeprecationWarning):
        assert _env.getenv("PROJECT") == "old"


def test_empty_values_count_as_unset(monkeypatch):
    monkeypatch.setenv("LANETRACE_PROJECT", "")
    monkeypatch.setenv("AGENTTRACE_PROJECT", "")
    assert _env.getenv("PROJECT") is None
    assert _env.getenv("PROJECT", "dflt") == "dflt"


def test_secret_from_the_old_name_when_the_new_one_is_empty(monkeypatch):
    from lanetrace.server import security

    monkeypatch.setenv("LANETRACE_SECRET", "")
    monkeypatch.setenv("AGENTTRACE_SECRET", "real-secret")
    with pytest.warns(DeprecationWarning):
        assert security._secret_key() == "real-secret"


def test_ui_auth_from_the_old_variable_logs_the_deprecation(fake_uvicorn, monkeypatch, caplog):
    monkeypatch.setenv("AGENTTRACE_AUTH", "none")
    with caplog.at_level(logging.WARNING, logger="lanetrace"):
        result = CliRunner().invoke(cli.main, ["ui"])
    assert result.exit_code == 0, result.output
    assert "AGENTTRACE_AUTH -> LANETRACE_AUTH" in caplog.text


def test_ui_auth_from_the_new_variable_logs_nothing(fake_uvicorn, monkeypatch, caplog):
    monkeypatch.setenv("LANETRACE_AUTH", "none")
    with caplog.at_level(logging.WARNING, logger="lanetrace"):
        result = CliRunner().invoke(cli.main, ["ui"])
    assert result.exit_code == 0, result.output
    assert "deprecated" not in caplog.text


@pytest.fixture
def no_secret(monkeypatch):
    for var in (*_env.names("SECRET"), *_env.names("REQUIRE_SECRET")):
        monkeypatch.delenv(var, raising=False)


def test_ui_refuses_to_start_without_a_required_secret(fake_uvicorn, no_secret, monkeypatch):
    monkeypatch.setenv("LANETRACE_REQUIRE_SECRET", "1")
    result = CliRunner().invoke(cli.main, ["ui", "--auth", "password"])
    assert result.exit_code == 1
    assert "LANETRACE_SECRET is not: set it" in result.output
    assert fake_uvicorn == []


def test_ui_starts_with_a_required_secret_from_either_name(fake_uvicorn, no_secret, monkeypatch):
    monkeypatch.setenv("LANETRACE_REQUIRE_SECRET", "1")
    monkeypatch.setenv("AGENTTRACE_SECRET", "s")
    result = CliRunner().invoke(cli.main, ["ui", "--auth", "password"])
    assert result.exit_code == 0, result.output
    assert len(fake_uvicorn) == 1


def test_server_refuses_to_start_without_a_required_secret(no_secret, monkeypatch):
    from fastapi.testclient import TestClient

    from lanetrace.server.app import app

    monkeypatch.setenv("LANETRACE_REQUIRE_SECRET", "1")
    monkeypatch.setenv("LANETRACE_AUTH", "password")
    with pytest.raises(RuntimeError, match="LANETRACE_SECRET is not: set it"):
        with TestClient(app):
            pass


def test_0_2_submodule_reexports():
    import importlib

    pytest.importorskip("langchain")
    # `lanetrace.langchain.autolog` the attribute is the function; get the module.
    autolog = importlib.import_module("lanetrace.langchain.autolog")
    async_callback = importlib.import_module("lanetrace.langchain.async_callback")
    from lanetrace.langchain.callback import LaneTraceCallbackHandler
    from lanetrace.tracking.async_run import AsyncLaneTraceRun

    assert autolog.AgentTraceCallbackHandler is LaneTraceCallbackHandler
    assert async_callback.AsyncAgentTraceRun is AsyncLaneTraceRun
