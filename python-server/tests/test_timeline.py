import uuid

from lanetrace.server.routes import timeline as timeline_route

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


def test_timeline_groups_runs_by_project_within_window(local_client):
    p = f"tl-{uuid.uuid4().hex[:6]}"
    inside, _ = make_run(p, "inside", hours_ago=2, events=[("User", "Orch", "handoff")])
    make_run(p, "too old", hours_ago=30)
    live_old, _ = make_run(p, "still running", hours_ago=40, status="running")
    body = local_client.get("/api/timeline?hours=24").json()
    project = next(x for x in body["projects"] if x["name"] == p)
    names = [r["name"] for r in project["runs"]]
    assert "inside" in names and "still running" in names and "too old" not in names
    run = next(r for r in project["runs"] if r["id"] == inside)
    assert run["eventCount"] == 1 and run["status"] == "completed" and run["startedAt"].endswith("+00:00")
    assert body["truncated"] is False
    starts = [r["startedAt"] for r in project["runs"]]
    assert starts == sorted(starts)


def test_projects_without_runs_are_listed(local_client):
    p = f"empty-{uuid.uuid4().hex[:6]}"
    make_run(p, "ancient", hours_ago=100)
    body = local_client.get("/api/timeline").json()
    assert next(x for x in body["projects"] if x["name"] == p)["runs"] == []


def test_cap_sets_truncated(local_client, monkeypatch):
    monkeypatch.setattr(timeline_route, "MAX_RUNS", 2)
    p = f"cap-{uuid.uuid4().hex[:6]}"
    for i in range(3):
        make_run(p, f"r{i}", hours_ago=1 + i * 0.1)
    body = local_client.get("/api/timeline").json()
    assert body["truncated"] is True
    assert sum(len(x["runs"]) for x in body["projects"]) == 2


def test_project_filter_and_bounds(local_client):
    p = f"filt-{uuid.uuid4().hex[:6]}"
    _, pid = make_run(p, "only", hours_ago=1)
    body = local_client.get(f"/api/timeline?projectId={pid}").json()
    assert [x["id"] for x in body["projects"]] == [pid]
    assert local_client.get("/api/timeline?projectId=nope").status_code == 404
    assert local_client.get("/api/timeline?hours=0").status_code == 422
    assert local_client.get("/api/timeline?hours=169").status_code == 422


def test_requires_login_in_password_mode(monkeypatch):
    monkeypatch.delenv("LANETRACE_AUTH", raising=False)
    from fastapi.testclient import TestClient as TC
    with TC(app) as c:
        assert c.get("/api/timeline").status_code == 401
