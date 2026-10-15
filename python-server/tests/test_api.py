import uuid

import pytest
from fastapi.testclient import TestClient

from lanetrace.server.app import app


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def _signup(client, email=None):
    email = email or f"{uuid.uuid4().hex}@example.com"
    resp = client.post("/api/auth/signup", json={"email": email, "password": "secret123", "name": "Test User"})
    assert resp.status_code == 201, resp.text
    return resp.json()["user"], email


def test_signup_signin_session_flow(client):
    user, email = _signup(client)
    assert user["email"] == email

    session = client.get("/api/auth/session").json()
    assert session["user"]["email"] == email

    client.post("/api/auth/signout")
    session = client.get("/api/auth/session").json()
    assert session["user"] is None

    ok = client.post("/api/auth/signin", json={"email": email, "password": "secret123"})
    assert ok.status_code == 200

    bad = client.post("/api/auth/signin", json={"email": email, "password": "wrong"})
    assert bad.status_code == 401
    assert bad.json() == {"error": "Incorrect password"}


def test_signup_rejects_short_password(client):
    resp = client.post("/api/auth/signup", json={"email": "x@example.com", "password": "abc"})
    assert resp.status_code == 400
    assert resp.json() == {"error": "Password must be at least 6 characters"}


def test_projects_require_auth(client):
    resp = client.get("/api/projects")
    assert resp.status_code == 401
    assert resp.json() == {"error": "Unauthorized"}


def test_create_and_list_project(client):
    _signup(client)

    created = client.post("/api/projects", json={"name": "Research Agent", "description": "demo"})
    assert created.status_code == 201
    body = created.json()
    assert body["project"]["name"] == "Research Agent"
    assert body["apiKey"].startswith("atr_")

    listed = client.get("/api/projects").json()["projects"]
    assert len(listed) == 1
    assert listed[0]["_count"]["runs"] == 0


def test_project_not_found_for_other_user(client):
    _signup(client)
    created = client.post("/api/projects", json={"name": "P1"}).json()
    project_id = created["project"]["id"]

    client.post("/api/auth/signout")
    _signup(client)  # a different user
    resp = client.get(f"/api/projects/{project_id}")
    assert resp.status_code == 404


def test_events_ingestion_full_lifecycle(client):
    _signup(client)
    created = client.post("/api/projects", json={"name": "Ingestion demo"}).json()
    project_id = created["project"]["id"]
    api_key = created["apiKey"]
    headers = {"Authorization": f"Bearer {api_key}"}

    started = client.post("/api/events", json={"runId": None, "name": "my run"}, headers=headers)
    assert started.status_code == 201
    run_id = started.json()["runId"]

    event = client.post(
        "/api/events",
        json={
            "runId": run_id,
            "source": "Orchestrator",
            "target": "web_search",
            "type": "tool_call",
            "label": "web_search(query)",
            "payload": {"args": {"query": "rust"}},
            "durationMs": 42,
        },
        headers=headers,
    )
    assert event.status_code == 201
    assert event.json()["event"]["seq"] == 0

    bad_type = client.post(
        "/api/events",
        json={"runId": run_id, "source": "A", "target": "B", "type": "not_a_type"},
        headers=headers,
    )
    assert bad_type.status_code == 400

    ended = client.post("/api/events", json={"runId": run_id, "endRun": "completed"}, headers=headers)
    assert ended.status_code == 200
    assert ended.json()["status"] == "completed"

    run_detail = client.get(f"/api/runs/{run_id}").json()["run"]
    assert run_detail["status"] == "completed"
    assert len(run_detail["events"]) == 1
    assert run_detail["events"][0]["type"] == "tool_call"

    events = client.get(f"/api/runs/{run_id}/events").json()["events"]
    assert len(events) == 1

    project_detail = client.get(f"/api/projects/{project_id}").json()["project"]
    assert len(project_detail["runs"]) == 1


def test_events_rejects_missing_api_key(client):
    resp = client.post("/api/events", json={"runId": None, "name": "x"})
    assert resp.status_code == 401
    assert resp.json() == {"error": "Missing or invalid API key"}


def test_events_rejects_invalid_api_key(client):
    resp = client.post(
        "/api/events", json={"runId": None, "name": "x"}, headers={"Authorization": "Bearer atr_deadbeef"}
    )
    assert resp.status_code == 401
    assert resp.json() == {"error": "Invalid API key"}


def test_stats_endpoint(client):
    _signup(client)
    created = client.post("/api/projects", json={"name": "Stats demo"}).json()
    api_key = created["apiKey"]
    headers = {"Authorization": f"Bearer {api_key}"}

    run_resp = client.post("/api/events", json={"runId": None, "name": "run 1"}, headers=headers)
    run_id = run_resp.json()["runId"]
    client.post("/api/events", json={"runId": run_id, "endRun": "completed"}, headers=headers)

    stats = client.get("/api/stats").json()
    assert stats["totalProjects"] == 1
    assert stats["totalRuns"] == 1
    assert stats["completed"] == 1
    assert stats["successRate"] == 100
    # Timestamps carry an explicit UTC offset so browsers don't read them as local time.
    assert stats["perProject"][0]["lastRunAt"].endswith("+00:00")
    [recent] = stats["recent"]
    assert recent["startedAt"].endswith("+00:00") and recent["endedAt"].endswith("+00:00")
    assert recent["events"] == 0 and recent["project"]["name"] == "Stats demo"
    assert stats["totalEvents"] == 0 and stats["typeDist"] == {}


def test_stats_counts_only_the_current_users_events(client):
    _signup(client)
    created = client.post("/api/projects", json={"name": "Mine"}).json()
    headers = {"Authorization": f"Bearer {created['apiKey']}"}
    run_id = client.post("/api/events", json={"runId": None, "name": "r"}, headers=headers).json()["runId"]
    for type_ in ("llm_call", "llm_call", "tool_call"):
        client.post("/api/events", json={"runId": run_id, "source": "a", "target": "b", "type": type_}, headers=headers)
    mine = client.get("/api/stats").json()
    assert mine["totalEvents"] == 3 and mine["typeDist"] == {"llm_call": 2, "tool_call": 1}
    assert mine["recent"][0]["events"] == 3

    client.post("/api/auth/signout")
    _signup(client)
    other = client.get("/api/stats").json()
    assert other["totalEvents"] == 0 and other["typeDist"] == {} and other["recent"] == []


def test_websocket_receives_broadcast_event(client):
    _signup(client)
    created = client.post("/api/projects", json={"name": "WS demo"}).json()
    api_key = created["apiKey"]
    headers = {"Authorization": f"Bearer {api_key}"}

    run_resp = client.post("/api/events", json={"runId": None, "name": "ws run"}, headers=headers)
    run_id = run_resp.json()["runId"]

    with client.websocket_connect("/ws") as ws:
        ws.send_json({"action": "subscribe", "runId": run_id})
        assert ws.receive_json() == {"type": "subscribed", "runId": run_id}

        client.post(
            "/api/events",
            json={"runId": run_id, "source": "Orchestrator", "target": "LLM", "type": "llm_call"},
            headers=headers,
        )

        message = ws.receive_json()
        assert message["type"] == "event"
        assert message["data"]["type"] == "llm_call"


def test_keys_management(client):
    _signup(client)
    created = client.post("/api/projects", json={"name": "Keys demo"}).json()
    project_id = created["project"]["id"]

    keys = client.get(f"/api/keys?projectId={project_id}").json()["keys"]
    assert len(keys) == 1  # the default key created with the project

    new_key = client.post("/api/keys", json={"projectId": project_id, "label": "CI key"})
    assert new_key.status_code == 201
    key_id = new_key.json()["key"]["id"]

    deleted = client.delete(f"/api/keys/{key_id}?projectId={project_id}")
    assert deleted.status_code == 200

    keys = client.get(f"/api/keys?projectId={project_id}").json()["keys"]
    assert len(keys) == 1


def test_websocket_cross_origin_refused_in_password_mode(client, monkeypatch):
    """The session cookie rides along on cross-site WebSocket handshakes (CSWSH)."""
    from starlette.websockets import WebSocketDisconnect

    monkeypatch.delenv("LANETRACE_ALLOWED_HOSTS", raising=False)
    _signup(client)
    with pytest.raises(WebSocketDisconnect) as refused:
        with client.websocket_connect("/ws", headers={"Origin": "http://evil.example"}):
            pass
    assert refused.value.code == 1008
    with client.websocket_connect("/ws", headers={"Origin": "http://testserver"}):
        pass
    with client.websocket_connect("/ws"):  # non-browser clients send no Origin
        pass
    monkeypatch.setenv("LANETRACE_ALLOWED_HOSTS", "evil.example")
    with client.websocket_connect("/ws", headers={"Origin": "http://evil.example"}):
        pass


def test_ingest_does_db_work_off_the_event_loop(client, monkeypatch):
    """A locked SQLite file (busy timeout 30 s) must not freeze the loop (poller, websockets)."""
    import asyncio

    from lanetrace.server.routes import events as events_route

    on_loop = []

    def record(real):
        def wrapper(*args, **kwargs):
            try:
                asyncio.get_running_loop()
                on_loop.append(True)
            except RuntimeError:
                on_loop.append(False)
            return real(*args, **kwargs)

        return wrapper

    for name in ("create_run", "append_event", "close_run"):
        monkeypatch.setattr(events_route, name, record(getattr(events_route, name)))
    _signup(client)
    headers = {"Authorization": f"Bearer {client.post('/api/projects', json={'name': 'loop'}).json()['apiKey']}"}
    run_id = client.post("/api/events", json={"runId": None, "name": "r"}, headers=headers).json()["runId"]
    event = {"runId": run_id, "source": "a", "target": "b", "type": "tool_call"}
    assert client.post("/api/events", json=event, headers=headers).status_code == 201
    assert client.post("/api/events", json={"runId": run_id, "endRun": "completed"}, headers=headers).status_code == 200
    assert on_loop == [False, False, False]


def test_event_counts_in_stats_and_project_detail(client):
    _signup(client)
    created = client.post("/api/projects", json={"name": "Counts"}).json()
    project_id = created["project"]["id"]
    headers = {"Authorization": f"Bearer {created['apiKey']}"}

    def run_with(types):
        run_id = client.post("/api/events", json={"runId": None, "name": "r"}, headers=headers).json()["runId"]
        for t in types:
            ok = client.post(
                "/api/events", json={"runId": run_id, "source": "A", "target": "B", "type": t}, headers=headers
            )
            assert ok.status_code == 201
        return run_id

    busy = run_with(["llm_call", "tool_call", "tool_result"])
    small = run_with(["llm_call"])
    empty = run_with([])

    stats = client.get("/api/stats").json()
    assert stats["totalEvents"] == 4
    assert stats["typeDist"] == {"llm_call": 2, "tool_call": 1, "tool_result": 1}
    assert {r["id"]: r["events"] for r in stats["recent"]} == {busy: 3, small: 1, empty: 0}

    runs = client.get(f"/api/projects/{project_id}").json()["project"]["runs"]
    assert {r["id"]: r["_count"]["events"] for r in runs} == {busy: 3, small: 1, empty: 0}
