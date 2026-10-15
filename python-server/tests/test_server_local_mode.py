import pytest
from starlette.websockets import WebSocketDisconnect
from fastapi.testclient import TestClient

from lanetrace.server.app import app
from lanetrace.tracking.stores.rest import RestStore


@pytest.fixture
def local_client(monkeypatch):
    monkeypatch.setenv("LANETRACE_AUTH", "none")
    monkeypatch.setenv("LANETRACE_ALLOWED_HOSTS", "testserver")
    with TestClient(app) as c:
        yield c


@pytest.mark.parametrize(
    "body",
    [b"{not json", b"", b"   ", b"\xff\xfe\xfa", b"[1, 2]", b'"a run"', b"null", b"42"],
    ids=["malformed", "empty", "blank", "not-text", "array", "string", "null", "number"],
)
def test_ingest_rejects_a_body_that_is_not_a_json_object(local_client, body):
    resp = local_client.post("/api/events", content=body, headers={"Content-Type": "application/json"})
    assert resp.status_code == 400
    assert resp.json() == {"error": "Invalid JSON body"}


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
    monkeypatch.setenv("LANETRACE_AUTH", "password")
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


def test_bad_host_rejected_in_none_mode(local_client):
    resp = local_client.get("/api/stats", headers={"Host": "evil.example"})
    assert resp.status_code == 403 and resp.json() == {"error": "Host not allowed"}


def test_ipv6_loopback_host_allowed(local_client):
    assert local_client.get("/api/stats", headers={"Host": "[::1]:3000"}).status_code == 200


def test_bad_origin_rejected_in_none_mode(local_client):
    resp = local_client.post(
        "/api/events", json={"runId": None, "name": "x", "project": "p"}, headers={"Origin": "http://evil.example"}
    )
    assert resp.status_code == 403 and resp.json() == {"error": "Origin not allowed"}


def test_loopback_origin_allowed(local_client):
    resp = local_client.get("/api/stats", headers={"Origin": "http://localhost:3000"})
    assert resp.status_code == 200


def test_websocket_bad_origin_refused(local_client):
    with pytest.raises(WebSocketDisconnect):
        with local_client.websocket_connect("/ws", headers={"Origin": "http://evil.example"}):
            pass


def test_websocket_good_origin_connects(local_client):
    with local_client.websocket_connect("/ws", headers={"Origin": "http://localhost:3000"}):
        pass


def test_password_mode_ignores_host_guard(monkeypatch):
    monkeypatch.setenv("LANETRACE_AUTH", "password")
    with TestClient(app) as c:
        resp = c.get("/api/auth/session", headers={"Host": "evil.example", "Origin": "http://evil.example"})
        assert resp.status_code == 200


def test_valid_key_of_other_project_cannot_touch_keyless_run(local_client):
    mine = local_client.post("/api/projects", json={"name": "mine"}).json()["project"]
    key = local_client.post("/api/keys", json={"projectId": mine["id"]}).json()["rawKey"]
    auth = {"Authorization": f"Bearer {key}"}
    other_run = local_client.post("/api/events", json={"runId": None, "name": "r", "project": "other"}).json()["runId"]

    ev = {"runId": other_run, "source": "a", "target": "b", "type": "llm_call"}
    assert local_client.post("/api/events", json=ev, headers=auth).status_code == 404
    assert local_client.post("/api/events", json={"runId": other_run, "endRun": "completed"}, headers=auth).status_code == 404


def test_session_returns_local_user_in_none_mode(local_client):
    user = local_client.get("/api/auth/session").json()["user"]
    assert user is not None and user["email"]
