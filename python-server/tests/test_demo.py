from click.testing import CliRunner
from fastapi.testclient import TestClient
import pytest

from agenttrace import cli
from agenttrace.server.app import app
from agenttrace.server.demo import SEED_PROJECTS, seed_demo
from agenttrace.store import db as store_db
from agenttrace.store import local, models

EXPECTED = {
    "Customer Support Agent": (4, 31),  # (runs, events)
    "Research Assistant": (3, 34),
    "Code Review Bot": (5, 35),
}


def test_seed_demo_creates_projects_runs_events_once(tmp_path):
    url = f"sqlite:///{tmp_path}/demo.db"
    store_db.init_db(url)
    with store_db.get_sessionmaker(url)() as db:
        user = local.get_or_create_local_user(db)
        assert seed_demo(db, user) == 3
        assert seed_demo(db, user) == 0
        projects = db.query(models.Project).filter(models.Project.user_id == user.id).all()
        got = {p.name: (len(p.runs), sum(len(r.events) for r in p.runs)) for p in projects}
        assert got == EXPECTED
        assert all(p.api_keys for p in projects)
        for p in projects:
            for r in p.runs:
                assert [e.seq for e in r.events] == list(range(len(r.events)))
                assert r.ended_at >= r.started_at


@pytest.fixture
def local_client(monkeypatch):
    monkeypatch.setenv("AGENTTRACE_AUTH", "none")
    monkeypatch.setenv("AGENTTRACE_ALLOWED_HOSTS", "testserver")
    with TestClient(app) as c:
        yield c


def test_seed_endpoint_is_idempotent(local_client):
    first = local_client.post("/api/seed").json()["seeded"]
    assert first in (0, 3)  # the shared test DB's local user may already have projects
    assert local_client.post("/api/seed").json() == {"seeded": 0}


def test_seed_requires_login_in_password_mode(monkeypatch):
    monkeypatch.delenv("AGENTTRACE_AUTH", raising=False)
    with TestClient(app) as c:
        assert c.post("/api/seed").status_code == 401


def test_demo_cli_seeds_target_database(tmp_path):
    url = f"sqlite:///{tmp_path}/cli.db"
    result = CliRunner().invoke(cli.main, ["demo", "--database-url", url])
    assert result.exit_code == 0, result.output
    assert "3 demo projects" in result.output
    again = CliRunner().invoke(cli.main, ["demo", "--database-url", url])
    assert "already has projects" in again.output


def _event(project, run_prefix, label):
    sp = next(p for p in SEED_PROJECTS if p["name"] == project)
    run = next(r for r in sp["runs"] if r["name"].startswith(run_prefix))
    return next(e for e in run["events"] if e["label"] == label)


def test_seed_payload_literals_are_faithful():
    retry = _event("Customer Support Agent", "Refund — Order #5102", "process_refund (attempt 2)")
    assert retry["payload"]["args"] == {"orderId": "5102", "amount": 142.5, "retry": True}
    assert _event("Customer Support Agent", "Refund — Order #6310", "order found")["payload"]["total"] == 54.0
    assert _event("Code Review Bot", "PR #145", "changes requested")["payload"]["status"] == "changes_requested"
    assert not any("{}" == repr(v) for sp in SEED_PROJECTS for r in sp["runs"] for e in r["events"]
                   for v in e["payload"].get("args", {}).values())


def test_seed_runs_fall_in_the_dashboard_24h_window(tmp_path):
    # the dashboard chronogram shows the last 24 hours: demo runs must be in it
    from datetime import datetime, timedelta, timezone

    url = f"sqlite:///{tmp_path}/window.db"
    store_db.init_db(url)
    with store_db.get_sessionmaker(url)() as db:
        user = local.get_or_create_local_user(db)
        seed_demo(db, user)
        now = datetime.now(timezone.utc)
        runs = db.query(models.Run).all()
        for r in runs:
            started = r.started_at if r.started_at.tzinfo else r.started_at.replace(tzinfo=timezone.utc)
            assert now - timedelta(hours=24) < started < now
        assert len({r.started_at for r in runs}) == len(runs)  # staggered, not stacked
