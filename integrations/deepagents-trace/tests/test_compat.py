"""deepagents-trace 0.3 keeps 0.2 code working on top of lanetrace."""

import importlib
import json
import os
import shutil
import subprocess
import sys
import warnings

import pytest

import lanetrace


def _fresh_agenttrace():
    """Re-import `agenttrace` from scratch; returns (module, warnings)."""
    for name in [m for m in sys.modules if m == "agenttrace" or m.startswith("agenttrace.")]:
        sys.modules.pop(name)
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        module = importlib.import_module("agenttrace")
    return module, [w for w in caught if issubclass(w.category, DeprecationWarning)]


@pytest.fixture
def agenttrace():
    module, _ = _fresh_agenttrace()
    return module


def test_import_warns_once():
    module, caught = _fresh_agenttrace()
    assert len(caught) == 1 and "import lanetrace" in str(caught[0].message)
    assert module.__version__ == lanetrace.__version__
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        importlib.import_module("agenttrace")  # cached: no second warning
        importlib.import_module("agenttrace.tracking.fluent")


def test_submodules_are_the_lanetrace_modules(agenttrace):
    import agenttrace.store.db
    import agenttrace.tracking.fluent
    from agenttrace.tracking.async_http import AsyncHttpEventClient

    import lanetrace.store.db
    import lanetrace.tracking.async_http
    import lanetrace.tracking.fluent

    assert agenttrace.tracking.fluent is lanetrace.tracking.fluent
    assert sys.modules["agenttrace.store.db"] is lanetrace.store.db
    assert AsyncHttpEventClient is lanetrace.tracking.async_http.AsyncHttpEventClient
    # The real module keeps its own identity.
    assert lanetrace.tracking.fluent.__name__ == "lanetrace.tracking.fluent"
    assert lanetrace.tracking.fluent.__spec__.name == "lanetrace.tracking.fluent"


def test_lazily_imported_submodules_resolve(agenttrace):
    old = importlib.import_module("agenttrace.langchain.projection")
    assert old is importlib.import_module("lanetrace.langchain.projection")
    app = importlib.import_module("agenttrace.server.app")
    assert app is importlib.import_module("lanetrace.server.app")


def test_missing_submodule_is_still_an_import_error(agenttrace):
    with pytest.raises(ModuleNotFoundError):
        importlib.import_module("agenttrace.does_not_exist")


def test_0_2_fluent_api(agenttrace, tmp_path, monkeypatch):
    for var in [v for v in os.environ if v.startswith(("AGENTTRACE_", "LANETRACE_"))]:
        monkeypatch.delenv(var)
    url = f"sqlite:///{tmp_path}/compat.db"
    agenttrace.set_tracking_uri(url)
    agenttrace.set_project("support-bot")
    try:
        with agenttrace.start_run("triage") as run:
            assert agenttrace.active_run() is run
            agenttrace.log_event(source="Orchestrator", target="LLM", type="llm_call", label="plan")
        client = agenttrace.AgentTraceClient(url)
        run_id = client.create_run("explicit", project="support-bot")
        client.log_event(run_id, source="a", target="b", type="tool_call")
        client.end_run(run_id)
    finally:
        agenttrace.set_tracking_uri(None)
        agenttrace.set_project(None)

    from agenttrace.store import db as store_db
    from agenttrace.store import models

    with store_db.get_sessionmaker(url)() as db:
        runs = {r.name: r for r in db.query(models.Run).all()}
        assert runs["triage"].status == "completed" and runs["triage"].project.name == "support-bot"
        assert [e.label for e in runs["triage"].events] == ["plan"]
        assert [e.type for e in runs["explicit"].events] == ["tool_call"]


def test_0_2_langchain_names(agenttrace):
    from agenttrace.langchain import (
        AgentTraceCallbackHandler,
        AgentTraceMiddleware,
        AsyncAgentTraceCallbackHandler,
        AsyncHttpEventClient,
        autolog,
    )

    import lanetrace.langchain as new

    assert AsyncAgentTraceCallbackHandler is new.AsyncLaneTraceCallbackHandler
    assert AgentTraceCallbackHandler is new.LaneTraceCallbackHandler
    assert AgentTraceMiddleware is new.LaneTraceMiddleware
    assert AsyncHttpEventClient is new.AsyncHttpEventClient and autolog is new.autolog


async def test_0_2_async_callback_handler_posts_events():
    import httpx

    from agenttrace.langchain import AsyncAgentTraceCallbackHandler
    from agenttrace.tracking.async_http import AsyncHttpEventClient

    sent = []

    def handler(request):
        sent.append(json.loads(request.content))
        return httpx.Response(201, json={"runId": "run_1"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        client = AsyncHttpEventClient(url="http://localhost:3000/api/events", api_key="atr_x", client=http)
        h = AsyncAgentTraceCallbackHandler("session-1", client=client)
        h.on_user_message("hello")
        await h.finish("completed", answer="done")
        await h.aclose()
    assert sent[0]["name"] == "session-1"
    assert sent[-1] == {"runId": "run_1", "endRun": "completed"}


def _run_cli(*args):
    script = shutil.which("agenttrace")
    cmd = [script, *args] if script else [sys.executable, "-m", "_agenttrace_cli", *args]
    return subprocess.run(cmd, capture_output=True, text=True, timeout=60)


def test_agenttrace_ui_help():
    result = _run_cli("ui", "--help")
    assert result.returncode == 0, result.stderr
    assert "Start the LaneTrace web UI" in result.stdout
    assert "--database-url" in result.stdout
    # One line: the command doesn't import agenttrace (no import-time warning).
    assert result.stderr.strip().count("\n") == 0, result.stderr
    assert "deprecated" in result.stderr and "lanetrace" in result.stderr


def test_agenttrace_version():
    result = _run_cli("--version")
    assert result.returncode == 0, result.stderr
    assert lanetrace.__version__ in result.stdout
