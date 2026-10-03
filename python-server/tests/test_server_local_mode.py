import pytest
from fastapi.testclient import TestClient

from agenttrace.server.app import app
from agenttrace.tracking.stores.rest import RestStore


@pytest.fixture
def local_client(monkeypatch):
    monkeypatch.setenv("AGENTTRACE_AUTH", "none")
    with TestClient(app) as c:
        yield c


def test_keyless_ingestion_creates_project_by_name(local_client):
    created = local_client.post("/api/events", json={"runId": None, "name": "r", "project": "support-bot"})
    assert created.status_code == 201
    run_id = created.json()["runId"]
    ev = local_client.post("/api/events", json={"runId": run_id, "source": "a", "target": "b", "type": "llm_call"})
    assert ev.status_code == 201
    again = local_client.post("/api/events", json={"runId": None, "name": "r2", "project": "support-bot"}).json()

    projects = local_client.get("/api/projects").json()["projects"]
    bot = [p for p in projects if p["name"] == "support-bot"]
    assert len(bot) == 1 and bot[0]["_count"]["runs"] >= 2
    assert local_client.get(f"/api/runs/{again['runId']}").status_code == 200


def test_keyless_create_requires_project(local_client):
    resp = local_client.post("/api/events", json={"runId": None, "name": "r"})
    assert resp.status_code == 400
    assert "project" in resp.json()["error"]


def test_dashboard_routes_work_without_login(local_client):
    assert local_client.get("/api/stats").status_code == 200


def test_api_key_still_takes_precedence(local_client, monkeypatch):
    resp = local_client.post(
        "/api/events", json={"runId": None, "name": "x"}, headers={"Authorization": "Bearer atr_deadbeef"}
    )
    assert resp.status_code == 401


def test_password_mode_unchanged(monkeypatch):
    monkeypatch.setenv("AGENTTRACE_AUTH", "password")
    with TestClient(app) as c:
        assert c.post("/api/events", json={"runId": None, "name": "x", "project": "p"}).status_code == 401
        assert c.get("/api/stats").status_code == 401


class _Session:
    """TestClient warns on the `timeout` kwarg RestStore passes; drop it."""

    def __init__(self, client):
        self._client = client

    def post(self, url, json=None, headers=None, timeout=None):
        return self._client.post(url, json=json, headers=headers)


def test_rest_store_end_to_end_against_local_server(local_client):
    store = RestStore("http://testserver/api/events", session=_Session(local_client))
    run_id = store.create_run("e2e", "rest run")
    store.log_event(run_id, {"source": "Orchestrator", "target": "web_search", "type": "tool_call"})
    store.end_run(run_id, "completed")
    run = local_client.get(f"/api/runs/{run_id}").json()["run"]
    assert run["status"] == "completed" and [e["type"] for e in run["events"]] == ["tool_call"]
