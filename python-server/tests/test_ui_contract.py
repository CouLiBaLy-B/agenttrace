import uuid

import pytest
from fastapi.testclient import TestClient

import lanetrace
from lanetrace.server.app import app


@pytest.fixture
def client(monkeypatch):
    monkeypatch.delenv("LANETRACE_AUTH", raising=False)
    with TestClient(app) as c:
        yield c


@pytest.fixture
def local_client(monkeypatch):
    monkeypatch.setenv("LANETRACE_AUTH", "none")
    monkeypatch.setenv("LANETRACE_ALLOWED_HOSTS", "testserver")
    with TestClient(app) as c:
        yield c


def _signup(client):
    resp = client.post(
        "/api/auth/signup", json={"email": f"{uuid.uuid4().hex}@x.dev", "password": "secret123", "name": "T"}
    )
    assert resp.status_code == 201
    return resp.json()["user"]


def test_run_detail_includes_project(client):
    user = _signup(client)
    project = client.post("/api/projects", json={"name": "UI contract"}).json()["project"]
    run = client.post(f"/api/projects/{project['id']}/runs", json={"name": "r"}).json()["run"]
    detail = client.get(f"/api/runs/{run['id']}").json()["run"]
    assert detail["project"] == {"id": project["id"], "name": "UI contract", "userId": user["id"]}


def test_session_reports_auth_mode_and_version_anonymous(client):
    body = client.get("/api/auth/session").json()
    assert body == {"user": None, "authMode": "password", "version": lanetrace.__version__}


def test_session_reports_auth_mode_signed_in(client):
    _signup(client)
    body = client.get("/api/auth/session").json()
    assert body["user"] is not None and body["authMode"] == "password"


def test_session_local_mode(local_client):
    body = local_client.get("/api/auth/session").json()
    assert body["authMode"] == "none" and body["user"]["email"] == "local@agenttrace"
    assert body["version"] == lanetrace.__version__
