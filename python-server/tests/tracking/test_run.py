import subprocess
import sys
import textwrap
import time

import pytest

from agenttrace.store import db as store_db
from agenttrace.store import models
from agenttrace.tracking.run import ActiveRun, compact, truncate
from agenttrace.tracking.stores.base import TrackingStore


class RecordingStore(TrackingStore):
    def __init__(self, fail_on=None):
        self.calls = []
        self.fail_on = fail_on

    def _record(self, *call):
        if self.fail_on == call[0]:
            raise ConnectionError("boom")
        self.calls.append(call)

    def create_run(self, project, name):
        self._record("create_run", project, name)
        return "run_1"

    def log_event(self, run_id, event):
        self._record("log_event", run_id, event)

    def end_run(self, run_id, status):
        self._record("end_run", run_id, status)


def _wait_until(predicate, timeout=2.0):
    deadline = time.time() + timeout
    while time.time() < deadline and not predicate():
        time.sleep(0.01)
    return predicate()


def test_truncate_and_compact():
    assert truncate("hello", 10) == "hello"
    assert truncate("x" * 20, 5) == "xxxxx…"
    assert compact({"a": 1}) == {"a": 1}
    assert isinstance(compact({"d": "x" * 5000}, limit=100), str)


def test_events_are_written_in_order_and_run_created_lazily():
    store = RecordingStore()
    run = ActiveRun(store, "r", project="p")
    time.sleep(0.05)
    assert store.calls == []  # nothing until the first item
    run.log_event(source="O", target="LLM", type="llm_call", duration_ms=5)
    run.log_event(source="O", target="User", type="final_answer")
    run.end()
    run.close(timeout=2)
    assert store.calls == [
        ("create_run", "p", "r"),
        ("log_event", "run_1", {"source": "O", "target": "LLM", "type": "llm_call", "durationMs": 5}),
        ("log_event", "run_1", {"source": "O", "target": "User", "type": "final_answer"}),
        ("end_run", "run_1", "completed"),
    ]


def test_invalid_type_raises_synchronously():
    run = ActiveRun(RecordingStore(), "r")
    with pytest.raises(ValueError, match="type must be one of"):
        run.log_event(source="a", target="b", type="nope")
    run.close(timeout=2)


def test_store_failure_disables_run_without_raising(caplog):
    store = RecordingStore(fail_on="log_event")
    run = ActiveRun(store, "r")
    run.log_event(source="a", target="b", type="tool_call")
    assert _wait_until(lambda: run._failed)
    run.log_event(source="a", target="b", type="tool_call")  # silently dropped
    run.end()
    run.close(timeout=2)
    assert store.calls == [("create_run", None, "r")]
    assert "AgentTrace disabled" in caplog.text


def test_context_manager_marks_failed_and_reraises():
    store = RecordingStore()
    with pytest.raises(KeyError):
        with ActiveRun(store, "r") as run:
            run.log_event(source="a", target="b", type="tool_call")
            raise KeyError("x")
    assert store.calls[-1] == ("end_run", "run_1", "failed")


def test_run_id_forces_creation_and_end_is_idempotent():
    ended = []
    store = RecordingStore()
    run = ActiveRun(store, "r", on_end=ended.append)
    assert run.run_id == "run_1"
    run.end("completed")
    run.end("failed")
    run.close(timeout=2)
    assert [c for c in store.calls if c[0] == "end_run"] == [("end_run", "run_1", "completed")]
    assert ended == [run]


def test_disabled_reason_never_touches_store(caplog):
    store = RecordingStore()
    run = ActiveRun(store, "r", disabled_reason="no key")
    run.log_event(source="a", target="b", type="tool_call")
    run.close(timeout=2)
    assert store.calls == [] and run.run_id is None and "no key" in caplog.text


def test_short_script_flushes_on_interpreter_exit(tmp_path):
    """Review focus #1: no explicit end/close, the process just exits."""
    url = f"sqlite:///{tmp_path}/exit.db"
    script = textwrap.dedent(f"""
        from agenttrace.tracking.run import ActiveRun
        from agenttrace.tracking.stores.sql import SqlStore
        run = ActiveRun(SqlStore({url!r}), "exit run")
        for i in range(20):
            run.log_event(source="O", target="T", type="tool_call", label=str(i))
    """)
    subprocess.run([sys.executable, "-c", script], check=True, timeout=60)
    with store_db.get_sessionmaker(url)() as db:
        run = db.query(models.Run).one()
        assert run.status == "completed"
        assert len(run.events) == 20


def test_compact_returns_json_safe_data():
    import datetime as dt
    from pathlib import Path

    assert compact({"p": Path("/a"), "t": dt.date(2026, 1, 2)}) == {"p": "/a", "t": "2026-01-02"}
