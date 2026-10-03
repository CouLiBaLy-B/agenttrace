"""End-to-end tests: run a real `agenttrace ui` (with the built bundle)
and drive the dashboard with Playwright. Needs the `e2e` extra and
`playwright install chromium`; skipped when the bundle isn't built."""

import os
import socket
import subprocess
import sys
import time
from pathlib import Path

import pytest
import requests

import agenttrace.server.app as server_app

BUNDLE = Path(server_app.__file__).parent / "static" / "index.html"


def pytest_collection_modifyitems(config, items):
    # A module-level `pytestmark` in conftest.py does not apply to test
    # modules, so mark the collected items explicitly.
    if BUNDLE.is_file():
        return
    skip = pytest.mark.skip(reason="UI bundle not built (bun run build:ui)")
    for item in items:
        item.add_marker(skip)


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _start(tmp_path: Path, auth: str):
    port = _free_port()
    db_url = f"sqlite:///{tmp_path}/e2e-{auth}.db"
    env = {**os.environ, "DATABASE_URL": db_url, "AGENTTRACE_SECRET": "e2e-secret"}
    env.pop("AGENTTRACE_AUTH", None)
    cli = [sys.executable, "-m", "agenttrace.cli"]
    if auth == "none":
        subprocess.run([*cli, "demo", "--database-url", db_url], check=True, env=env)
    proc = subprocess.Popen([*cli, "ui", "--port", str(port), "--auth", auth], env=env)
    base = f"http://127.0.0.1:{port}"
    for _ in range(100):
        try:
            if requests.get(f"{base}/api/auth/session", timeout=1).ok:
                break
        except requests.RequestException:
            time.sleep(0.1)
    else:
        proc.kill()
        raise RuntimeError("agenttrace ui did not start")
    return proc, base, db_url


@pytest.fixture
def local_server(tmp_path):
    proc, base, db_url = _start(tmp_path, "none")
    yield base, db_url
    proc.terminate()
    proc.wait(10)


@pytest.fixture
def password_server(tmp_path):
    proc, base, db_url = _start(tmp_path, "password")
    yield base, db_url
    proc.terminate()
    proc.wait(10)
