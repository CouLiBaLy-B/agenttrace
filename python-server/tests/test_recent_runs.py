import uuid

import os
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from agenttrace.server.app import app
from agenttrace.store import db as store_db
from agenttrace.store import events as store_events
from agenttrace.store import local, models


@pytest.fixture
def local_client(monkeypatch):
    monkeypatch.setenv("AGENTTRACE_AUTH", "none")
    monkeypatch.setenv("AGENTTRACE_ALLOWED_HOSTS", "testserver")
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
