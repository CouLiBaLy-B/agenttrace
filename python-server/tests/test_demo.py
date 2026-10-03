from click.testing import CliRunner
from fastapi.testclient import TestClient
import pytest

from agenttrace import cli
from agenttrace.server.app import app
from agenttrace.server.demo import seed_demo
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
