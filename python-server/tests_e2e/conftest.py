"""End-to-end tests: run a real `lanetrace ui` (with the built bundle)
and drive the dashboard with Playwright. Needs the `e2e` extra and
`playwright install chromium`; skipped when the bundle isn't built."""

import os
import re
import socket
import subprocess
import sys
import time
from pathlib import Path

import pytest
import requests

import lanetrace.server.app as server_app
from lanetrace import _env

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
    env = {**os.environ, "DATABASE_URL": db_url, "LANETRACE_SECRET": "e2e-secret"}
    for var in ("LANETRACE_AUTH", "AGENTTRACE_AUTH"):  # AGENTTRACE_*: pre-rename fallback
        env.pop(var, None)
    cli = [sys.executable, "-m", "lanetrace.cli"]
    if auth == "none":
        subprocess.run([*cli, "demo", "--database-url", db_url], check=True, env=env)
    proc = subprocess.Popen([*cli, "ui", "--port", str(port), "--auth", auth], env=env)
    base = f"http://127.0.0.1:{port}"
    deadline = time.monotonic() + 30
    while True:
        code = proc.poll()
        if code is not None:
            raise RuntimeError(f"lanetrace ui exited during startup (code {code})")
        try:
            if requests.get(f"{base}/api/auth/session", timeout=1).ok:
                break
        except requests.RequestException:
            pass
        if time.monotonic() > deadline:
            _stop(proc)
            raise RuntimeError("lanetrace ui did not start within 30 s")
        time.sleep(0.1)
    return proc, base, db_url


def _stop(proc: subprocess.Popen) -> None:
    proc.terminate()
    try:
        proc.wait(10)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait()


@pytest.fixture
def local_server(tmp_path):
    proc, base, db_url = _start(tmp_path, "none")
    yield base, db_url
    _stop(proc)


@pytest.fixture
def password_server(tmp_path):
    proc, base, db_url = _start(tmp_path, "password")
    yield base, db_url
    _stop(proc)


# ── helpers shared by the e2e modules ───────────────────────────

THEMES = ("phosphore", "cyanotype", "studio")
THEME_LABELS = {"phosphore": "Phosphore", "cyanotype": "Cyanotype", "studio": "Studio"}
THEME_STORAGE_KEY = "lanetrace-theme"
# A theme switch plays a ~450 ms reveal during which Chromium keeps the page
# inert; give it this long before the next click.
THEME_REVEAL_MS = 500


def theme_init_script(theme: str) -> str:
    """An init script storing a theme preference before the boot script reads it."""
    return f"try {{ localStorage.setItem({THEME_STORAGE_KEY!r}, {theme!r}) }} catch (e) {{}}"


def watch_console(page) -> list[str]:
    """Collects console errors and warnings plus uncaught page errors."""
    problems: list[str] = []
    page.on(
        "console",
        lambda msg: problems.append(f"console.{msg.type}: {msg.text}") if msg.type in ("error", "warning") else None,
    )
    page.on("pageerror", lambda err: problems.append(f"pageerror: {err}"))
    return problems


def wait_for(page, predicate, what: str, timeout: float = 10.0) -> None:
    """Polls a Python predicate; page.wait_for_timeout keeps Playwright
    dispatching events to our handlers meanwhile."""
    deadline = time.monotonic() + timeout
    while not predicate():
        if time.monotonic() > deadline:
            raise AssertionError(f"timed out waiting for {what}")
        page.wait_for_timeout(50)


def open_run(page, base: str, run_name: str | None = None, timeout: float = 15_000):
    """Opens a run from the dashboard's recent-runs feed (the first tile when
    no name is given) and returns the diagram locator."""
    from playwright.sync_api import expect

    page.goto(base)
    feed = page.locator("section[aria-labelledby='run-feed-title']")
    if run_name is None:
        tile = feed.get_by_role("button").first
    else:
        tile = feed.get_by_role("button", name=re.compile("^" + re.escape(run_name) + ", "))
    tile.click(timeout=timeout)
    diagram = page.get_by_test_id("diagram")
    expect(diagram).to_be_visible(timeout=timeout)
    return diagram


def arrow(diagram, label: str):
    """An arrow of the run diagram by its event label (end of its accessible name)."""
    return diagram.get_by_role("button", name=re.compile(re.escape(label) + "$"))


def screenshot_dir() -> Path:
    path = Path(_env.getenv("SCREENSHOT_DIR") or Path(__file__).parent / "artifacts")
    path.mkdir(parents=True, exist_ok=True)
    return path
