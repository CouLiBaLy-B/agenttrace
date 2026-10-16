import pytest
from fastapi.testclient import TestClient

from lanetrace.server.app import create_app


@pytest.fixture
def bundle(tmp_path):
    (tmp_path / "_next" / "static").mkdir(parents=True)
    (tmp_path / "index.html").write_text("<!doctype html><title>LaneTrace UI</title>")
    (tmp_path / "_next" / "static" / "app.js").write_text("console.log('ui')")
    return tmp_path


def test_serves_bundle_when_present(bundle, monkeypatch):
    monkeypatch.setenv("LANETRACE_STATIC_DIR", str(bundle))
    with TestClient(create_app()) as c:
        index = c.get("/")
        assert index.status_code == 200 and "LaneTrace UI" in index.text
        asset = c.get("/_next/static/app.js")
        assert asset.status_code == 200 and "console.log" in asset.text


def test_unknown_api_path_is_json_404(bundle, monkeypatch):
    monkeypatch.setenv("LANETRACE_STATIC_DIR", str(bundle))
    with TestClient(create_app()) as c:
        resp = c.get("/api/does-not-exist")
        assert resp.status_code == 404
        assert resp.json() == {"error": "Not found"}


def test_api_still_works_with_bundle(bundle, monkeypatch):
    monkeypatch.setenv("LANETRACE_STATIC_DIR", str(bundle))
    with TestClient(create_app()) as c:
        assert c.get("/api/auth/session").status_code == 200


def test_placeholder_without_bundle(tmp_path, monkeypatch):
    monkeypatch.setenv("LANETRACE_STATIC_DIR", str(tmp_path / "missing"))
    with TestClient(create_app()) as c:
        page = c.get("/")
        assert page.status_code == 200
        assert "bun run build:ui" in page.text


def test_html_is_revalidated_and_hashed_assets_are_immutable(bundle, monkeypatch):
    (bundle / "settings").mkdir()
    (bundle / "settings" / "index.html").write_text("<!doctype html><title>Settings</title>")
    monkeypatch.setenv("LANETRACE_STATIC_DIR", str(bundle))
    with TestClient(create_app()) as c:
        for path in ("/", "/index.html", "/settings/"):
            resp = c.get(path)
            assert resp.status_code == 200, path
            assert resp.headers["cache-control"] == "no-cache", path
        asset = c.get("/_next/static/app.js")
        assert asset.headers["cache-control"] == "public, max-age=31536000, immutable"
