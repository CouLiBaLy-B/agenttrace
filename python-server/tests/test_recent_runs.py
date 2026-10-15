import uuid

import os
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from lanetrace.server.app import app
from lanetrace.store import db as store_db
from lanetrace.store import events as store_events
from lanetrace.store import local, models


@pytest.fixture
def local_client(monkeypatch):
    monkeypatch.setenv("LANETRACE_AUTH", "none")
    monkeypatch.setenv("LANETRACE_ALLOWED_HOSTS", "testserver")
    with TestClient(app) as c:
        yield c


def make_run(project_name, name, *, hours_ago=0.0, status="completed", events=(), duration_s=2.0):
    url = os.environ["DATABASE_URL"]
    with store_db.get_sessionmaker(url)() as db:
        user = local.get_or_create_local_user(db)
        project = local.get_or_create_project(db, user, project_name)
        start = datetime.now(timezone.utc) - timedelta(hours=hours_ago)
        run = models.Run(project_id=project.id, name=name, status=status, started_at=start,
                         ended_at=None if status == "running" else start + timedelta(seconds=duration_s))
        db.add(run)
        db.commit()
        for source, target, type_ in events:
            store_events.append_event(db, run.id, {"source": source, "target": target, "type": type_})
        return run.id, project.id


def test_recent_runs_with_shape(local_client):
    p = f"rec-{uuid.uuid4().hex[:6]}"
    events = [("User", "Orch", "handoff"), ("Orch", "LLM", "llm_call"), ("Orch", "web_search", "tool_call"),
              ("web_search", "Orch", "tool_result")] + [("Orch", "LLM", "llm_call")] * 12
    run_id, pid = make_run(p, "shaped", hours_ago=0.01, status="running", events=events)
    body = local_client.get(f"/api/runs/recent?projectId={pid}").json()
    [run] = body["runs"]
    assert run["id"] == run_id and run["status"] == "running" and run["endedAt"] is None and run["durationMs"] is None
    assert run["eventCount"] == 16 and run["project"] == {"id": pid, "name": p}
    assert run["shape"]["participants"] == ["User", "Orch", "LLM", "web_search"]
    assert len(run["shape"]["events"]) == 12
    assert run["shape"]["events"][0] == {"s": 0, "t": 1, "type": "handoff", "status": "ok"}
    assert run["shape"]["events"][3] == {"s": 3, "t": 1, "type": "tool_result", "status": "ok"}


def test_recent_orders_newest_first_and_limits(local_client):
    p = f"ord-{uuid.uuid4().hex[:6]}"
    make_run(p, "older", hours_ago=2)
    make_run(p, "newer", hours_ago=1)
    _, pid = make_run(p, "newest", hours_ago=0.5)
    runs = local_client.get(f"/api/runs/recent?projectId={pid}&limit=2").json()["runs"]
    assert [r["name"] for r in runs] == ["newest", "newer"]
    assert runs[0]["durationMs"] == 2000


def test_recent_bounds_and_route_order(local_client):
    assert local_client.get("/api/runs/recent?limit=0").status_code == 422
    assert local_client.get("/api/runs/recent?limit=51").status_code == 422
    # /recent must not be captured by GET /api/runs/{run_id}
    assert "runs" in local_client.get("/api/runs/recent").json()


def _count_queries(client, url):
    from sqlalchemy import event

    from lanetrace.server.db import engine

    statements = []

    def before(conn, cursor, statement, *args):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", before)
    try:
        body = client.get(url).json()
    finally:
        event.remove(engine, "before_cursor_execute", before)
    return body, len(statements)


def test_recent_query_count_does_not_grow_with_runs(local_client):
    one = f"q1-{uuid.uuid4().hex[:6]}"
    _, pid_one = make_run(one, "only", events=[("a", "b", "llm_call")])
    many = f"q6-{uuid.uuid4().hex[:6]}"
    for i in range(6):
        _, pid_many = make_run(many, f"r{i}", hours_ago=i * 0.1, events=[("a", "b", "llm_call")] * (i + 1))
    _, few = _count_queries(local_client, f"/api/runs/recent?projectId={pid_one}")
    body, lots = _count_queries(local_client, f"/api/runs/recent?projectId={pid_many}")
    assert lots == few
    # each run still gets its own counts and shape (first 12 events, per run)
    assert [r["eventCount"] for r in body["runs"]] == [1, 2, 3, 4, 5, 6]
    assert [len(r["shape"]["events"]) for r in body["runs"]] == [1, 2, 3, 4, 5, 6]


def test_recent_breaks_start_time_ties_by_id_desc(local_client):
    p = f"tie-{uuid.uuid4().hex[:6]}"
    url = os.environ["DATABASE_URL"]
    start = datetime.now(timezone.utc) - timedelta(minutes=5)
    with store_db.get_sessionmaker(url)() as db:
        user = local.get_or_create_local_user(db)
        project = local.get_or_create_project(db, user, p)
        runs = [models.Run(project_id=project.id, name=f"t{i}", status="completed", started_at=start) for i in range(3)]
        db.add_all(runs)
        db.commit()
        ids, pid = sorted((r.id for r in runs), reverse=True), project.id
    got = [r["id"] for r in local_client.get(f"/api/runs/recent?projectId={pid}").json()["runs"]]
    assert got == ids


def test_other_users_project_is_invisible_in_password_mode(monkeypatch):
    monkeypatch.delenv("LANETRACE_AUTH", raising=False)
    with TestClient(app) as a, TestClient(app) as b:
        for c in (a, b):
            r = c.post("/api/auth/signup", json={"email": f"{uuid.uuid4().hex}@example.com", "password": "secret123", "name": "U"})
            assert r.status_code == 201, r.text
        created = a.post("/api/projects", json={"name": "A's project"}).json()
        pid = created["project"]["id"]
        headers = {"Authorization": f"Bearer {created['apiKey']}"}
        a.post("/api/events", json={"runId": None, "name": "secret run"}, headers=headers)
        assert len(a.get(f"/api/runs/recent?projectId={pid}").json()["runs"]) == 1
        assert b.get(f"/api/runs/recent?projectId={pid}").json() == {"runs": []}
        assert b.get(f"/api/timeline?projectId={pid}").status_code == 404
