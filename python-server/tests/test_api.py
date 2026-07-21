import uuid

import pytest
from fastapi.testclient import TestClient

from agenttrace.server.app import app


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


def test_signup_seeds_demo_projects(client):
    _signup(client)
    projects = client.get("/api/projects").json()["projects"]
    names = {p["name"] for p in projects}
    assert names == {"Customer Support Agent", "Research Assistant", "Code Review Bot"}
    # Idempotent: a second signup (different user) also seeds fresh demo data
    # for that user, not a no-op — projects are per-user.
    client.post("/api/auth/signout")
    _signup(client)
    assert len(client.get("/api/projects").json()["projects"]) == 3


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

    # Signup auto-seeds 3 demo projects (matches the original Next.js
    # behavior — see seed.py) alongside the one just created above.
    listed = client.get("/api/projects").json()["projects"]
    assert len(listed) == 4
    created_project = next(p for p in listed if p["name"] == "Research Agent")
    assert created_project["_count"]["runs"] == 0


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
    # Regression: the frontend's run-view reads run.project.name directly
    # (matches the original route.ts's `include: { project: {...} } }`) —
    # a flat projectId alone crashes it.
    assert run_detail["project"]["id"] == project_id
    assert "name" in run_detail["project"]

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

    # Signup auto-seeds 3 demo projects/12 runs alongside "Stats demo" — assert
    # against that project specifically rather than exact totals, so this
    # test doesn't couple to seed.py's dataset shape.
    stats = client.get("/api/stats").json()
    assert stats["totalProjects"] == 4
    stats_demo = next(p for p in stats["perProject"] if p["name"] == "Stats demo")
    assert stats_demo["runs"] == 1
    assert stats_demo["successRate"] == 100


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
