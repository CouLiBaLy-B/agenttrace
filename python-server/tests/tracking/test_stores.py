import pytest

from lanetrace.store import db as store_db
from lanetrace.store import models
from lanetrace.tracking.stores import store_for_uri
from lanetrace.tracking.stores.rest import RestStore
from lanetrace.tracking.stores.sql import SqlStore


def test_sql_store_round_trip(tmp_path):
    url = f"sqlite:///{tmp_path}/s.db"
    store = SqlStore(url)
    run_id = store.create_run("support-bot", "first")
    store.log_event(run_id, {"source": "Orchestrator", "target": "LLM", "type": "llm_call", "durationMs": 3})
    store.log_event(run_id, {"source": "Orchestrator", "target": "User", "type": "final_answer"})
    store.end_run(run_id, "completed")

    with store_db.get_sessionmaker(url)() as db:
        run = db.get(models.Run, run_id)
        assert run.status == "completed"
        assert run.project.name == "support-bot"
        assert run.project.user.email == "local@agenttrace"
        assert [e.type for e in run.events] == ["llm_call", "final_answer"]


def test_sql_store_reuses_project_by_name(tmp_path):
    store = SqlStore(f"sqlite:///{tmp_path}/s.db")
    a, b = store.create_run("p", "a"), store.create_run("p", "b")
    with store_db.get_sessionmaker(store.url)() as db:
        assert db.get(models.Run, a).project_id == db.get(models.Run, b).project_id


def test_sql_store_end_unknown_run_raises(tmp_path):
    with pytest.raises(LookupError):
        SqlStore(f"sqlite:///{tmp_path}/s.db").end_run("missing", "completed")


class FakeResponse:
    def __init__(self, status_code=201, body=None):
        self.status_code = status_code
        self._body = body or {"runId": "run_1"}

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self):
        return self._body


class FakeSession:
    def __init__(self, response=None):
        self.calls = []
        self.response = response or FakeResponse()

    def post(self, url, json, headers, timeout):
        self.calls.append({"url": url, "json": json, "headers": headers})
        return self.response


def test_rest_store_keyless_sends_project_and_no_auth_header():
    session = FakeSession()
    store = RestStore("http://h/api/events", session=session)
    assert store.create_run("support-bot", "r") == "run_1"
    store.log_event("run_1", {"source": "A", "target": "B", "type": "tool_call"})
    store.end_run("run_1", "failed")
    assert session.calls[0]["json"] == {"runId": None, "name": "r", "project": "support-bot"}
    assert "Authorization" not in session.calls[0]["headers"]
    assert session.calls[1]["json"] == {"runId": "run_1", "source": "A", "target": "B", "type": "tool_call"}
    assert session.calls[2]["json"] == {"runId": "run_1", "endRun": "failed"}


def test_rest_store_with_key_and_no_project():
    session = FakeSession()
    RestStore("http://h/api/events", api_key="atr_x", session=session).create_run(None, "r")
    assert session.calls[0]["json"] == {"runId": None, "name": "r"}
    assert session.calls[0]["headers"]["Authorization"] == "Bearer atr_x"


def test_rest_store_401_without_key_mentions_lanetrace_key():
    """Review focus #5."""
    store = RestStore("http://h/api/events", session=FakeSession(FakeResponse(401, {"error": "x"})))
    with pytest.raises(PermissionError, match="LANETRACE_KEY"):
        store.create_run("p", "r")


def test_store_for_uri(monkeypatch, tmp_path):
    monkeypatch.setenv("LANETRACE_KEY", "atr_env")
    rest = store_for_uri("http://h:3000")
    assert isinstance(rest, RestStore)
    assert rest.events_url == "http://h:3000/api/events" and rest.api_key == "atr_env"
    assert isinstance(store_for_uri(f"sqlite:///{tmp_path}/x.db"), SqlStore)


def test_rest_store_sanitizes_non_json_values():
    from pathlib import Path

    session = FakeSession()
    RestStore("http://h/api/events", session=session).log_event("run_1", {"source": "A", "target": "B", "type": "tool_call", "payload": {"p": Path("/a")}})
    assert session.calls[0]["json"]["payload"] == {"p": "/a"}
