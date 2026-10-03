import asyncio
import threading

import pytest

import agenttrace
from tests.conftest import read_runs


def test_start_run_context_manager_writes_to_tracking_db(tracking_db):
    agenttrace.set_project("support-bot")
    with agenttrace.start_run("first") as run:
        assert agenttrace.active_run() is run
        agenttrace.log_event(source="Orchestrator", target="LLM", type="llm_call")
    assert agenttrace.active_run() is None
    [stored] = read_runs(tracking_db)
    assert stored["name"] == "first" and stored["project"] == "support-bot"
    assert stored["status"] == "completed"
    assert [e["type"] for e in stored["events"]] == ["llm_call"]


def test_exception_marks_run_failed(tracking_db):
    with pytest.raises(RuntimeError):
        with agenttrace.start_run("boom"):
            raise RuntimeError("x")
    assert read_runs(tracking_db)[0]["status"] == "failed"


def test_nested_runs_are_separate_and_stack(tracking_db):
    with agenttrace.start_run("outer") as outer:
        with agenttrace.start_run("inner") as inner:
            assert agenttrace.active_run() is inner
            agenttrace.log_event(source="a", target="b", type="tool_call")
        assert agenttrace.active_run() is outer
    runs = {r["name"]: r for r in read_runs(tracking_db)}
    assert len(runs["inner"]["events"]) == 1 and runs["outer"]["events"] == []


def test_log_event_without_run_starts_implicit_run(tracking_db):
    agenttrace.log_event(source="a", target="b", type="tool_call")
    implicit = agenttrace.active_run()
    assert implicit is not None and implicit.name.startswith("run ")
    agenttrace.end_run()
    assert agenttrace.active_run() is None
    [stored] = read_runs(tracking_db)
    assert stored["status"] == "completed" and stored["project"] == "Default"


def test_project_env_var(tracking_db, monkeypatch):
    monkeypatch.setenv("AGENTTRACE_PROJECT", "from-env")
    assert agenttrace.get_project() == "from-env"
    agenttrace.set_project("explicit")
    assert agenttrace.get_project() == "explicit"


def test_runs_are_isolated_per_thread(tracking_db):
    seen = {}
    with agenttrace.start_run("main"):
        t = threading.Thread(target=lambda: seen.setdefault("other", agenttrace.active_run()))
        t.start()
        t.join()
    assert seen["other"] is None


async def test_runs_are_isolated_per_asyncio_task(tracking_db):
    async def worker(name):
        with agenttrace.start_run(name) as run:
            await asyncio.sleep(0.01)
            assert agenttrace.active_run() is run

    await asyncio.gather(worker("a"), worker("b"))
    assert sorted(r["name"] for r in read_runs(tracking_db)) == ["a", "b"]


def test_trace_decorator_sync_success_and_error(tracking_db):
    @agenttrace.trace
    def add(a, b):
        return a + b

    @agenttrace.trace(target="flaky")
    def explode():
        raise ValueError("nope")

    with agenttrace.start_run("traced"):
        assert add(1, b=2) == 3
        with pytest.raises(ValueError):
            explode()

    events = read_runs(tracking_db)[0]["events"]
    assert [(e["type"], e["source"], e["target"]) for e in events] == [
        ("tool_call", "Orchestrator", "add"),
        ("tool_result", "add", "Orchestrator"),
        ("tool_call", "Orchestrator", "flaky"),
        ("error", "flaky", "Orchestrator"),
    ]
    assert events[0]["payload"] == {"args": [1], "kwargs": {"b": 2}}
    assert events[1]["payload"] == {"result": 3}
    assert events[3]["payload"] == {"error": "ValueError", "message": "nope"}
    assert events[3]["status"] == "error"


async def test_trace_decorator_async(tracking_db):
    @agenttrace.trace
    async def fetch(url):
        await asyncio.sleep(0)
        return "ok"

    with agenttrace.start_run("async"):
        assert await fetch("x") == "ok"
    assert [e["type"] for e in read_runs(tracking_db)[0]["events"]] == ["tool_call", "tool_result"]


async def test_trace_decorator_async_error(tracking_db):
    @agenttrace.trace
    async def boom():
        await asyncio.sleep(0)
        raise KeyError("k")

    with agenttrace.start_run("async-err"):
        with pytest.raises(KeyError):
            await boom()
    events = read_runs(tracking_db)[0]["events"]
    assert [e["type"] for e in events] == ["tool_call", "error"]
    assert events[1]["status"] == "error"


def test_trace_survives_hostile_arguments(tracking_db):
    class BadRepr:
        def __repr__(self):
            raise RuntimeError("repr")

    class BadStr:
        def __str__(self):
            raise RuntimeError("str")

    @agenttrace.trace
    def f(*args, **kwargs):
        return "ok"

    with agenttrace.start_run("hostile"):
        assert f(BadRepr(), x=BadStr()) == "ok"
        assert f(BadStr()) == "ok"


def test_explicit_active_run_ignores_the_implicit_run(tracking_db):
    from agenttrace.tracking import fluent

    agenttrace.log_event(source="a", target="b", type="tool_call")
    assert fluent.active_run() is not None and fluent.explicit_active_run() is None
    with agenttrace.start_run("explicit") as run:
        assert fluent.explicit_active_run() is run
