# Bundled UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `pip install 'deepagents-trace[server]' && agenttrace ui` serves the real AgentTrace dashboard (static Next.js export) from FastAPI, with no Node at runtime and the Next.js backend removed.

**Architecture:** The Next.js app becomes a pure static export (`output: "export"`), talking to FastAPI through same-origin `/api/*` and a native WebSocket on `/ws`. NextAuth and Socket.IO are replaced by two small client modules (`src/lib/session.ts`, `src/lib/live.ts`). FastAPI mounts the bundle (package data `agenttrace/server/static/`) after its API routes. Demo data moves to Python (`agenttrace demo`, `POST /api/seed`). Docker becomes a single Python image built with a bun stage.

**Tech Stack:** Next.js 16 (static export), React 19, TanStack Query, Bun ≥1.3, FastAPI/Starlette `StaticFiles`, setuptools package-data, pytest, Playwright (Python) for e2e, GitHub Actions, Docker.

**Spec:** `docs/superpowers/specs/2026-10-03-bundled-ui-design.md`

## Global Constraints

- Branch `feat/bundled-ui` (based on `feat/mlflow-like-sdk`). Package root `python-server/`, import package `agenttrace`, version stays `0.2.0`.
- No Node/Bun at runtime: the wheel ships `agenttrace/server/static/` (built bundle); the bundle is git-ignored, never committed.
- FastAPI is the only backend. All UI requests are same-origin relative URLs (`/api/...`, `/ws`).
- `GET /api/auth/session` returns `{"user": <user|null>, "authMode": "none"|"password", "version": "<agenttrace.__version__>"}`.
- `GET /api/runs/{id}` returns `run.project = {"id", "name", "userId"}`.
- Demo: `agenttrace demo [--database-url URL]` and `POST /api/seed` → `{"seeded": n}`; idempotent (only seeds a user with zero projects); no demo credentials in the bundle; no seeding on signup.
- WebSocket URL: `NEXT_PUBLIC_AGENTTRACE_WS_URL` if set (dev only), else `ws(s)://${location.host}/ws`. Reconnect backoff 1 s doubling, capped at 15 s.
- `typescript.ignoreBuildErrors` is removed: `bun run typecheck` (tsc --noEmit) and `bun run lint` must pass.
- Fonts from the `geist` npm package (no network at build time after `bun install`).
- Python test runner: `.venv/bin/pytest python-server/tests -q` from repo root (separate invocation from `integrations/agenttrace-langchain/tests`). Frontend: `bun run lint`, `bun run typecheck`, `bun run build:ui`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **Refresh / open a second tab while a run is live** — the diagram must show all events (REST load + WebSocket merge, no duplicates, seq order). Covered: Task 5 merge logic + Task 9 e2e.
2. **Server restarted while the UI is open** — the WebSocket reconnects with backoff and re-subscribes; no error spam. Covered: Task 5 (`subscribeRun` reconnect) — manual check step.
3. **Unknown `/api/...` path or typo** — must be a JSON 404, not the HTML index (UI error toasts parse JSON). Covered: Task 3 test.
4. **Source install without a built bundle** — `agenttrace ui` must still work (placeholder with build instructions). Covered: Task 3 test.
5. **Session expires in password mode** — the next API 401 sends the user back to the auth screen instead of broken views. Covered: Task 4 (QueryCache `onError`) + Task 9 e2e sign-out path.

---

## File Structure

```
python-server/
  agenttrace/server/serializers.py     MODIFY  run_detail_out adds project
  agenttrace/server/routes/auth.py     MODIFY  session adds authMode, version
  agenttrace/server/demo.py            CREATE  seed_demo(db, user) (port of src/lib/seed.ts)
  agenttrace/server/routes/seed.py     CREATE  POST /api/seed
  agenttrace/server/app.py             MODIFY  seed router, /api 404 catch-all, StaticFiles mount, placeholder text
  agenttrace/cli.py                    MODIFY  `agenttrace demo`
  agenttrace/server/static/            BUILD OUTPUT (git-ignored, package data)
  pyproject.toml                       MODIFY  package-data, [postgres], [e2e] extras
  MANIFEST.in                          CREATE  include static in sdist
  scripts/check_wheel.py               CREATE  asserts static/index.html in wheel
  tests/test_ui_contract.py            CREATE  run.project, session fields
  tests/test_demo.py                   CREATE  seed + /api/seed + CLI
  tests/test_static_ui.py              CREATE  bundle serving / placeholder / JSON 404
  tests_e2e/conftest.py, test_dashboard.py   CREATE  Playwright e2e
src/
  lib/session.ts                       CREATE  useSession, useAuthActions
  lib/live.ts                          CREATE  subscribeRun (native WebSocket)
  components/providers.tsx             MODIFY  no SessionProvider; 401 → session invalidation
  app/page.tsx                         MODIFY  gate on new session hook
  app/layout.tsx                       MODIFY  geist fonts, local favicon
  components/auth/auth-screen.tsx      MODIFY  new actions, no demo login
  components/layout/sidebar.tsx        MODIFY  new session, hide sign-out in none mode
  components/layout/footer.tsx         MODIFY  label
  components/views/settings-view.tsx   MODIFY  new session, local mode, seed button, version
  components/views/integration-view.tsx MODIFY origin-based, mode-aware snippets
  components/sequence-diagram/sequence-diagram.tsx  MODIFY  live.ts instead of socket.io
  components/ui/sonner.tsx             MODIFY  drop next-themes
  app/api/**, lib/{db,auth,api-auth,keys,seed,socket-client}.ts, lib/session.ts(old server one → replaced),
  lib/db.sqlite.ts.example, types/next-auth.d.ts                    DELETE
next.config.ts, package.json, bun.lock, scripts/copy-ui.mjs        MODIFY / CREATE
prisma/, prisma.config.ts, mini-services/, Caddyfile, db/, .scripts/   DELETE
Dockerfile, docker-compose.yml, .dockerignore, .env.example        REWRITE
.github/workflows/ci.yml, publish-pypi.yml                          MODIFY
.gitignore                                                           MODIFY  ignore python-server/agenttrace/server/static/, out/
README.md, python-server/README.md, docs/user-manual.md (pointer)   MODIFY
```

Note on `src/lib/session.ts`: the existing file is a server-side NextAuth helper (`getServerSession`). Task 4 overwrites it with the new client module; the only importers of the old one are API route handlers, which Task 6 deletes (Task 4 must not break the build in between — see Task 4 Step 1).

---

### Task 0: Toolchain check (controller, no commit)

- [ ] **Step 1:** `bun --version` must print ≥ 1.3. If bun is missing, stop and ask the user to install it (`curl -fsSL https://bun.sh/install | bash`) — do not install it unprompted.
- [ ] **Step 2:** `bun install` at repo root (creates `node_modules/`, already git-ignored). Then `bunx tsc --noEmit 2>&1 | tail -5` and record the current number of type errors in the ledger as the baseline (Task 6 must bring it to zero).
- [ ] **Step 3:** `.venv/bin/pytest python-server/tests -q` → all pass (baseline).

---

### Task 1: Backend contract fixes (run.project, session authMode/version)

**Files:**
- Modify: `python-server/agenttrace/server/serializers.py` (`run_detail_out`), `python-server/agenttrace/server/routes/auth.py` (`session`)
- Test: `python-server/tests/test_ui_contract.py`

**Interfaces:**
- Produces: `GET /api/runs/{id}` → `run.project == {"id", "name", "userId"}`; `GET /api/auth/session` → keys `user`, `authMode`, `version`.

- [ ] **Step 1: Write the failing tests**

`python-server/tests/test_ui_contract.py`:
```python
import uuid

import pytest
from fastapi.testclient import TestClient

import agenttrace
from agenttrace.server.app import app


@pytest.fixture
def client(monkeypatch):
    monkeypatch.delenv("AGENTTRACE_AUTH", raising=False)
    with TestClient(app) as c:
        yield c


@pytest.fixture
def local_client(monkeypatch):
    monkeypatch.setenv("AGENTTRACE_AUTH", "none")
    monkeypatch.setenv("AGENTTRACE_ALLOWED_HOSTS", "testserver")
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
    assert body == {"user": None, "authMode": "password", "version": agenttrace.__version__}


def test_session_reports_auth_mode_signed_in(client):
    _signup(client)
    body = client.get("/api/auth/session").json()
    assert body["user"] is not None and body["authMode"] == "password"


def test_session_local_mode(local_client):
    body = local_client.get("/api/auth/session").json()
    assert body["authMode"] == "none" and body["user"]["email"] == "local@agenttrace"
    assert body["version"] == agenttrace.__version__
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/pytest python-server/tests/test_ui_contract.py -q`
Expected: 4 FAIL (`KeyError: 'project'`, missing `authMode`).

- [ ] **Step 3: Implement**

`serializers.py`:
```python
def run_detail_out(run: models.Run) -> dict[str, Any]:
    data = run_out(run)
    data["project"] = {"id": run.project.id, "name": run.project.name, "userId": run.project.user_id}
    data["events"] = [event_out(e) for e in run.events]
    return data
```
(keep whatever the current function already returns; only add the `project` key).

`routes/auth.py` `session`:
```python
    mode = auth_mode()
    base = {"authMode": mode, "version": __version__}
    if mode == "none":
        return {"user": user_out(get_or_create_local_user(db)), **base}
    token = request.cookies.get(SESSION_COOKIE_NAME)
    user_id = read_session_token(token) if token else None
    user = db.get(models.User, user_id) if user_id else None
    return {"user": user_out(user) if user else None, **base}
```
with `from ... import __version__` (i.e. `from agenttrace import __version__`; mind circular imports — `agenttrace/__init__.py` does not import the server, so this is safe). Update the docstring: "also returns `authMode` and `version` so the static UI can adapt (local mode hides login)".

- [ ] **Step 4: Run to verify pass**

Run: `.venv/bin/pytest python-server/tests -q` → all PASS (existing session tests that compare the whole body must be updated to include the two new keys — only if they fail).

- [ ] **Step 5: Commit**

```bash
git add -A python-server
git commit -m "feat(server): run detail includes project; session reports authMode and version"
```

---

### Task 2: Demo seed in Python (`seed_demo`, `POST /api/seed`, `agenttrace demo`)

**Files:**
- Create: `python-server/agenttrace/server/demo.py`, `python-server/agenttrace/server/routes/seed.py`
- Modify: `python-server/agenttrace/server/app.py` (include router), `python-server/agenttrace/cli.py`
- Test: `python-server/tests/test_demo.py`

**Interfaces:**
- Consumes: `agenttrace.store.models`, `agenttrace.store.local.get_or_create_local_user`, `agenttrace.server.security.{generate_api_key, hash_api_key, key_prefix}`, `agenttrace.server.deps.require_user`.
- Produces: `agenttrace.server.demo.SEED_PROJECTS` (list of dicts), `seed_demo(db: Session, user: models.User) -> int`; route `POST /api/seed` → `{"seeded": int}`; CLI `agenttrace demo [--database-url URL]`.

- [ ] **Step 1: Port the data**

Read `src/lib/seed.ts` fully. In `python-server/agenttrace/server/demo.py`, transcribe the three projects (`customerSupport`, the research assistant, the code review bot — exact names, descriptions, run names, statuses, and every event's `source/target/type/label/offsetSec/durationMs/status/payload`) into a module-level `SEED_PROJECTS: list[dict]` with snake_case keys (`offset_sec`, `duration_ms`). Keep the content byte-for-byte equivalent (labels and payload values). Then port `seedDemoData`:

```python
"""Demo data — the three sample projects the old Next.js app seeded on
signup, now opt-in: `agenttrace demo` or the Settings button
(`POST /api/seed`). Seeding only happens for a user with no projects."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from ..store import models
from .security import generate_api_key, hash_api_key, key_prefix

DAY = timedelta(days=1)

SEED_PROJECTS: list[dict] = [...]  # transcribed from src/lib/seed.ts


def seed_demo(db: Session, user: models.User) -> int:
    if db.query(models.Project).filter(models.Project.user_id == user.id).count():
        return 0
    now = datetime.now(timezone.utc)
    for p_idx, sp in enumerate(SEED_PROJECTS):
        project = models.Project(name=sp["name"], description=sp["description"], user_id=user.id)
        db.add(project)
        db.flush()
        raw = generate_api_key()
        db.add(models.ApiKey(project_id=project.id, key_hash=hash_api_key(raw), prefix=key_prefix(raw), label="Demo key"))
        for run_idx, sr in enumerate(sp["runs"]):
            # same timing rule as seed.ts
            started = now - len(SEED_PROJECTS) * DAY + timedelta(hours=6 * run_idx)
            total_ms = max(
                ((e["offset_sec"] + (e.get("duration_ms") or 0) / 1000) * 1000 for e in sr["events"]), default=0
            )
            run = models.Run(
                project_id=project.id,
                name=sr["name"],
                status=sr["status"],
                started_at=started,
                ended_at=started + timedelta(milliseconds=total_ms),
            )
            db.add(run)
            db.flush()
            for seq, ev in enumerate(sr["events"]):
                db.add(
                    models.Event(
                        run_id=run.id,
                        seq=seq,
                        timestamp=started + timedelta(seconds=ev["offset_sec"]),
                        source=ev["source"],
                        target=ev["target"],
                        type=ev["type"],
                        label=ev.get("label"),
                        payload=json.dumps(ev.get("payload", {})),
                        duration_ms=ev.get("duration_ms"),
                        status=ev.get("status") or ("error" if ev["type"] == "error" else "ok"),
                    )
                )
    db.commit()
    return len(SEED_PROJECTS)
```
Check `seed.ts` lines 249-313 for anything else it writes (key label, project ordering, `p_idx` usage) and mirror it exactly; if the TS timing formula differs from the one above, follow the TS file.

- [ ] **Step 2: Write the failing tests**

`python-server/tests/test_demo.py` (replace `EXPECTED_RUNS` / `EXPECTED_EVENTS` with the counts you get by counting runs/events per project in `src/lib/seed.ts` — write them as literals, not computed from `SEED_PROJECTS`):
```python
import os

import pytest
from click.testing import CliRunner
from fastapi.testclient import TestClient

from agenttrace import cli
from agenttrace.server.app import app
from agenttrace.server.demo import seed_demo
from agenttrace.store import db as store_db
from agenttrace.store import local, models

EXPECTED = {
    "Customer Support Agent": (0, 0),  # (runs, events) — fill from seed.ts
    "Research Assistant": (0, 0),
    "Code Review Bot": (0, 0),
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
```

- [ ] **Step 3: Run to verify failure**

Run: `.venv/bin/pytest python-server/tests/test_demo.py -q` → FAIL (`ModuleNotFoundError: agenttrace.server.demo` until Step 1 is saved; then route/CLI failures).

- [ ] **Step 4: Implement route and CLI**

`routes/seed.py`:
```python
"""POST /api/seed — load the demo projects for the current user (the local
user in `--auth none` mode). Idempotent: does nothing if projects exist."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import models
from ..db import get_db
from ..demo import seed_demo
from ..deps import require_user

router = APIRouter(prefix="/api/seed", tags=["seed"])


@router.post("")
def seed(user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    return {"seeded": seed_demo(db, user)}
```
`app.py`: `from .routes import ..., seed` and `app.include_router(seed.router)`.

`cli.py`:
```python
@main.command()
@click.option("--database-url", envvar="DATABASE_URL", default=None, help="Target database (default: ./agenttrace.db).")
def demo(database_url: str | None) -> None:
    """Load three demo projects into the local database (no-op if it already has projects)."""
    _require_server_extra()
    from .server.demo import seed_demo
    from .store import db as store_db
    from .store.local import get_or_create_local_user

    url = database_url or store_db.DEFAULT_SQLITE_URL
    store_db.init_db(url)
    with store_db.get_sessionmaker(url)() as db:
        n = seed_demo(db, get_or_create_local_user(db))
    if n:
        click.echo(f"[AgentTrace] Loaded {n} demo projects into {url}. Run `agenttrace ui` to explore them.")
    else:
        click.echo(f"[AgentTrace] {url} already has projects for the local user — nothing to do.")
```

- [ ] **Step 5: Run to verify pass**

Run: `.venv/bin/pytest python-server/tests -q` → all PASS.

- [ ] **Step 6: Commit**

```bash
git add -A python-server
git commit -m "feat: demo projects in Python (agenttrace demo, POST /api/seed)"
```

---

### Task 3: Serve the bundle from FastAPI (+ packaging)

**Files:**
- Modify: `python-server/agenttrace/server/app.py`, `python-server/pyproject.toml`, `.gitignore`
- Create: `python-server/MANIFEST.in`, `python-server/scripts/check_wheel.py`
- Test: `python-server/tests/test_static_ui.py`

**Interfaces:**
- Produces: `agenttrace.server.app.STATIC_DIR` (default `Path(__file__).parent / "static"`, overridable by env `AGENTTRACE_STATIC_DIR` read in `create_app()`); `create_app()` mounts the bundle when `STATIC_DIR/index.html` exists; `/api/{path}` unknown → JSON 404 `{"error": "Not found"}`.

- [ ] **Step 1: Write the failing tests**

`python-server/tests/test_static_ui.py`:
```python
import pytest
from fastapi.testclient import TestClient

from agenttrace.server.app import create_app


@pytest.fixture
def bundle(tmp_path):
    (tmp_path / "_next" / "static").mkdir(parents=True)
    (tmp_path / "index.html").write_text("<!doctype html><title>AgentTrace UI</title>")
    (tmp_path / "_next" / "static" / "app.js").write_text("console.log('ui')")
    return tmp_path


def test_serves_bundle_when_present(bundle, monkeypatch):
    monkeypatch.setenv("AGENTTRACE_STATIC_DIR", str(bundle))
    with TestClient(create_app()) as c:
        index = c.get("/")
        assert index.status_code == 200 and "AgentTrace UI" in index.text
        asset = c.get("/_next/static/app.js")
        assert asset.status_code == 200 and "console.log" in asset.text


def test_unknown_api_path_is_json_404(bundle, monkeypatch):
    monkeypatch.setenv("AGENTTRACE_STATIC_DIR", str(bundle))
    with TestClient(create_app()) as c:
        resp = c.get("/api/does-not-exist")
        assert resp.status_code == 404
        assert resp.json() == {"error": "Not found"}


def test_api_still_works_with_bundle(bundle, monkeypatch):
    monkeypatch.setenv("AGENTTRACE_STATIC_DIR", str(bundle))
    with TestClient(create_app()) as c:
        assert c.get("/api/auth/session").status_code == 200


def test_placeholder_without_bundle(tmp_path, monkeypatch):
    monkeypatch.setenv("AGENTTRACE_STATIC_DIR", str(tmp_path / "missing"))
    with TestClient(create_app()) as c:
        page = c.get("/")
        assert page.status_code == 200
        assert "bun run build:ui" in page.text
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/pytest python-server/tests/test_static_ui.py -q` → FAIL (index is the placeholder; `/api/does-not-exist` returns `{"detail": "Not Found"}`).

- [ ] **Step 3: Implement**

`app.py`:
- `import os`, `from pathlib import Path`, `from fastapi.staticfiles import StaticFiles`.
- `DEFAULT_STATIC_DIR = Path(__file__).parent / "static"`.
- Replace `PLACEHOLDER_HTML`'s paragraph with: "The web dashboard bundle isn't included in this install. Build it from a source checkout with `bun install && bun run build:ui`, or install a released wheel (`pip install 'deepagents-trace[server]'`). The API is available under `/api/*`."
- At the END of `create_app()` (after every router, `/ws`):
```python
    @app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"], include_in_schema=False)
    async def api_not_found(path: str):
        return JSONResponse(status_code=404, content={"error": "Not found"})

    static_dir = Path(os.getenv("AGENTTRACE_STATIC_DIR") or DEFAULT_STATIC_DIR)
    if (static_dir / "index.html").is_file():
        app.mount("/", StaticFiles(directory=static_dir, html=True), name="ui")
    else:
        @app.get("/", response_class=HTMLResponse, include_in_schema=False)
        async def index():
            return PLACEHOLDER_HTML
```
(remove the old unconditional `@app.get("/")`). The catch-all must be registered after all real `/api` routers so they match first.

`pyproject.toml`:
```toml
[tool.setuptools.package-data]
agenttrace = ["server/static/**/*"]
```
and in `[project.optional-dependencies]`: `postgres = ["psycopg[binary]>=3.1"]`, `e2e = ["playwright>=1.47", "pytest-playwright>=0.5"]`.

`python-server/MANIFEST.in`:
```
recursive-include agenttrace/server/static *
```

`python-server/scripts/check_wheel.py`:
```python
"""Fail if a built wheel doesn't ship the UI bundle (used by CI and the
PyPI publish workflow): `python scripts/check_wheel.py dist/*.whl`."""

import sys
import zipfile

REQUIRED = "agenttrace/server/static/index.html"

for path in sys.argv[1:]:
    with zipfile.ZipFile(path) as wheel:
        if REQUIRED not in wheel.namelist():
            sys.exit(f"{path}: missing {REQUIRED} — run `bun run build:ui` before building the wheel")
    print(f"{path}: UI bundle present")
```

`.gitignore`: add `python-server/agenttrace/server/static/` and `/out/`.

- [ ] **Step 4: Run to verify pass**

Run: `.venv/bin/pytest python-server/tests -q` → all PASS.

- [ ] **Step 5: Commit**

```bash
git add -A python-server .gitignore
git commit -m "feat(server): serve the UI bundle from package data; JSON 404 for unknown /api paths"
```

---

### Task 4: Frontend session client (replace NextAuth on the client)

**Files:**
- Create (overwrite): `src/lib/session.ts`
- Modify: `src/components/providers.tsx`, `src/app/page.tsx`, `src/components/auth/auth-screen.tsx`, `src/components/layout/sidebar.tsx`, `src/components/views/settings-view.tsx`

**Interfaces:**
- Produces (`@/lib/session`): `type AuthMode = "none" | "password"`; `interface SessionUser { id: string; email: string; name: string | null }`; `SESSION_KEY = ["session"]`; `useSession(): { status: "loading" | "authenticated" | "unauthenticated"; user: SessionUser | null; authMode: AuthMode; version: string }`; `useAuthActions(): { signIn(email, password), signUp(email, password, name?), signOut() }` (all `Promise<void>`, throw `Error(serverMessage)` on failure).

- [ ] **Step 1: Keep the build green during the swap**

The old `src/lib/session.ts` is imported by API route handlers (`grep -rln "@/lib/session" src/app/api`). Before overwriting it, `git mv src/lib/session.ts src/lib/server-session.ts` and update those imports to `@/lib/server-session` (Task 6 deletes both the routes and this file).

- [ ] **Step 2: Write `src/lib/session.ts`**

```ts
"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"

export type AuthMode = "none" | "password"

export interface SessionUser {
  id: string
  email: string
  name: string | null
}

interface SessionResponse {
  user: SessionUser | null
  authMode: AuthMode
  version: string
}

export const SESSION_KEY = ["session"] as const

export function useSession() {
  const query = useQuery({
    queryKey: SESSION_KEY,
    queryFn: () => api<SessionResponse>("/api/auth/session"),
    staleTime: 60_000,
    retry: 1,
  })
  const status: "loading" | "authenticated" | "unauthenticated" = query.isPending
    ? "loading"
    : query.data?.user
      ? "authenticated"
      : "unauthenticated"
  return {
    status,
    user: query.data?.user ?? null,
    authMode: query.data?.authMode ?? "password",
    version: query.data?.version ?? "",
  }
}

export function useAuthActions() {
  const qc = useQueryClient()
  // resetQueries refetches the session and drops every cached view of the
  // previous account, so data never leaks between sign-ins.
  const refresh = () => qc.resetQueries()
  return {
    async signIn(email: string, password: string) {
      await api("/api/auth/signin", { method: "POST", json: { email, password } })
      await refresh()
    },
    async signUp(email: string, password: string, name?: string) {
      await api("/api/auth/signup", { method: "POST", json: { email, password, name: name || undefined } })
      await refresh()
    },
    async signOut() {
      await api("/api/auth/signout", { method: "POST" })
      await refresh()
    },
  }
}
```

- [ ] **Step 3: Rewire consumers**

`providers.tsx`: remove `SessionProvider`; build the client with a `QueryCache` that sends the user back to the auth screen on 401s:
```tsx
import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { SESSION_KEY } from "@/lib/session"
...
  const [client] = useState(() => {
    const qc: QueryClient = new QueryClient({
      queryCache: new QueryCache({
        onError: (error, query) => {
          if (error instanceof Error && error.message === "Unauthorized" && query.queryKey[0] !== SESSION_KEY[0]) {
            qc.invalidateQueries({ queryKey: SESSION_KEY })
          }
        },
      }),
      defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1, staleTime: 10_000 } },
    })
    return qc
  })
```

`app/page.tsx`:
```tsx
"use client"

import { useSession } from "@/lib/session"
import { AuthScreen } from "@/components/auth/auth-screen"
import { AppShell } from "@/components/app-shell"
import { BootScreen } from "@/components/boot-screen"

export default function Home() {
  const { status } = useSession()
  if (status === "loading") return <BootScreen />
  if (status === "unauthenticated") return <AuthScreen />
  return <AppShell />
}
```
(In `none` mode the session always has the local user, so `AuthScreen` never renders.)

`auth-screen.tsx`:
- `const { signIn, signUp } = useAuthActions()`; `submit` becomes:
```tsx
    setLoading(true)
    try {
      if (mode === "signup") await signUp(email, password, name)
      else await signIn(email, password)
      toast.success(mode === "signup" ? "Account created" : "Signed in")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setLoading(false)
    }
```
- Delete `DEMO_EMAIL`, `DEMO_PASSWORD`, `demoLogin` and the "Explore the live demo" button block (~line 157 and its surrounding divider); replace the signup hint "We'll load three demo projects to get you started." with "Tip: run `agenttrace demo` to load sample projects." (or an equivalent short line). Remove the `window.location.reload()` calls.

`sidebar.tsx` and `settings-view.tsx`:
- `import { useSession, useAuthActions } from "@/lib/session"`; replace `session?.user?.x` with `user?.x`.
- Sign-out handlers: `await signOut(); toast.success("Signed out")` (no reload).
- When `authMode === "none"`: hide the sign-out button(s) and, in Settings, replace the Account inputs with a short "Local mode — no account (started with `agenttrace ui --auth none`)" note.

- [ ] **Step 4: Verify**

Run: `grep -rn "next-auth/react" src/components src/app/page.tsx` → no output. `bunx tsc --noEmit 2>&1 | grep -E "session|auth-screen|sidebar|settings-view|providers|page.tsx"` → no errors in the touched files (the global baseline from Task 0 may still have unrelated errors; Task 6 clears them).

- [ ] **Step 5: Commit**

```bash
git add -A src
git commit -m "feat(ui): session client on FastAPI auth routes, local-mode aware"
```

---

### Task 5: Live updates over native WebSocket

**Files:**
- Create: `src/lib/live.ts`
- Modify: `src/components/sequence-diagram/sequence-diagram.tsx`

**Interfaces:**
- Produces (`@/lib/live`): `liveUrl(): string`; `subscribeRun(runId: string, handlers: LiveHandlers): () => void` where `LiveHandlers = { onEvent?(ev: TraceEvent): void; onRunUpdate?(patch: { status?: string; endedAt?: string | null }): void; onSubscribed?(): void; onError?(message: string): void; onConnectionChange?(connected: boolean): void }`.

- [ ] **Step 1: Write `src/lib/live.ts`**

```ts
"use client"

import type { TraceEvent } from "@/lib/types"

export interface LiveHandlers {
  onEvent?: (event: TraceEvent) => void
  onRunUpdate?: (patch: { status?: string; endedAt?: string | null }) => void
  onSubscribed?: () => void
  onError?: (message: string) => void
  onConnectionChange?: (connected: boolean) => void
}

const MAX_BACKOFF_MS = 15_000

export function liveUrl(): string {
  const override = process.env.NEXT_PUBLIC_AGENTTRACE_WS_URL
  if (override) return override
  const proto = window.location.protocol === "https:" ? "wss" : "ws"
  return `${proto}://${window.location.host}/ws`
}

/** Subscribe to one run's live events on the FastAPI `/ws` endpoint.
 * Reconnects with exponential backoff (1 s → 15 s) and re-subscribes; a
 * server `error` (unknown run, subscription cap) stops reconnecting. */
export function subscribeRun(runId: string, handlers: LiveHandlers): () => void {
  let socket: WebSocket | null = null
  let stopped = false
  let attempt = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  const connect = () => {
    const ws = new WebSocket(liveUrl())
    socket = ws
    ws.onopen = () => {
      attempt = 0
      handlers.onConnectionChange?.(true)
      ws.send(JSON.stringify({ action: "subscribe", runId }))
    }
    ws.onmessage = (message) => {
      let msg: any
      try {
        msg = JSON.parse(String(message.data))
      } catch {
        return
      }
      if (msg.type === "event") {
        if (msg.data?.runId === runId) handlers.onEvent?.(msg.data as TraceEvent)
        return
      }
      if (msg.runId !== runId) return
      if (msg.type === "subscribed") handlers.onSubscribed?.()
      else if (msg.type === "run:update") handlers.onRunUpdate?.(msg.patch ?? {})
      else if (msg.type === "error") {
        stopped = true
        handlers.onError?.(String(msg.error ?? "live updates unavailable"))
        ws.close()
      }
    }
    ws.onclose = () => {
      handlers.onConnectionChange?.(false)
      if (stopped) return
      const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt)
      attempt += 1
      timer = setTimeout(connect, delay)
    }
    ws.onerror = () => ws.close()
  }

  connect()

  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ action: "unsubscribe", runId }))
    }
    socket?.close()
  }
}
```

- [ ] **Step 2: Rewire `sequence-diagram.tsx`**

- Remove `import { io, Socket } from "socket.io-client"` and `socketRef`; add `import { subscribeRun } from "@/lib/live"` and `import { api } from "@/lib/api"`.
- Keep `onRunUpdate` in a ref so the effect doesn't resubscribe on every parent render:
```tsx
  const onRunUpdateRef = useRef(onRunUpdate)
  useEffect(() => {
    onRunUpdateRef.current = onRunUpdate
  }, [onRunUpdate])

  // ---- live: subscribe for new events (and close the REST→WS gap) ----
  useEffect(() => {
    if (!live) return
    const merge = (incoming: TraceEvent[]) =>
      setEvents((prev) => {
        const seen = new Set(prev.map((e) => e.id))
        const fresh = incoming.filter((e) => !seen.has(e.id))
        if (!fresh.length) return prev
        return [...prev, ...fresh].sort((a, b) => a.seq - b.seq)
      })
    return subscribeRun(runId, {
      onConnectionChange: setConnected,
      // Events written between the page's REST load and the subscription
      // are not streamed (the server cursor starts at subscribe time).
      onSubscribed: () => {
        api<{ run: { events: TraceEvent[] } }>(`/api/runs/${runId}`)
          .then((data) => merge(data.run.events))
          .catch(() => {})
      },
      onEvent: (event) => merge([event]),
      onRunUpdate: (patch) => {
        if (patch.status) {
          setStatus(patch.status as typeof status)
          onRunUpdateRef.current?.(patch)
        }
      },
      onError: () => setConnected(false),
    })
  }, [runId, live])
```
- Keep the replay logic and everything else unchanged.

- [ ] **Step 3: Verify**

`grep -rn "socket.io" src` → no output. `bunx tsc --noEmit 2>&1 | grep -E "live.ts|sequence-diagram"` → no errors.

Manual check (Review Focus #2), if bun is available: `agenttrace ui --auth none` in one terminal (from a temp dir, after `agenttrace demo`), `NEXT_PUBLIC_AGENTTRACE_WS_URL=ws://localhost:3000/ws bun run dev` in another (this works after Task 6's `next.config.ts`; if running Task 5 before Task 6, skip and note it in the report — Task 9's e2e covers live behaviour).

- [ ] **Step 4: Commit**

```bash
git add -A src
git commit -m "feat(ui): live updates over the FastAPI /ws WebSocket with reconnect and gap fill"
```

---

### Task 6: Remove the Next.js backend; static export build

**Files:**
- Delete: `src/app/api/`, `src/lib/{db,auth,api-auth,keys,seed,socket-client,server-session}.ts`, `src/lib/db.sqlite.ts.example`, `src/types/next-auth.d.ts`, `prisma/`, `prisma.config.ts`, `mini-services/`, `Caddyfile`, `db/`, `.scripts/`
- Modify: `next.config.ts`, `package.json`, `bun.lock`, `src/app/layout.tsx`, `src/components/ui/sonner.tsx`, `src/components/layout/footer.tsx`
- Create: `scripts/copy-ui.mjs`

**Interfaces:**
- Produces: `bun run build:ui` → static export copied to `python-server/agenttrace/server/static/` (contains `index.html` and `_next/`); `bun run typecheck`; `bun run dev` on :3001 proxying `/api/*` to `AGENTTRACE_DEV_BACKEND` (default `http://127.0.0.1:3000`).

- [ ] **Step 1: Delete backend files**

```bash
git rm -r src/app/api prisma prisma.config.ts mini-services Caddyfile db .scripts src/types/next-auth.d.ts src/lib/db.sqlite.ts.example
git rm src/lib/db.ts src/lib/auth.ts src/lib/api-auth.ts src/lib/keys.ts src/lib/seed.ts src/lib/socket-client.ts src/lib/server-session.ts
grep -rnE "@/lib/(db|auth|api-auth|keys|seed|socket-client|server-session)\b|next-auth|@prisma|socket\.io" src && echo "LEFTOVER" || echo ok
```
(If `src/lib/seed.ts` exports anything the UI uses — e.g. `getDemoKeyHint` — remove that usage.)

- [ ] **Step 2: `next.config.ts`**

```ts
import type { NextConfig } from "next"

// Production builds are a static export served by the Python package
// (`agenttrace ui`). In development, `next dev` proxies the API to a
// running `agenttrace ui` (default http://127.0.0.1:3000); the WebSocket
// connects directly via NEXT_PUBLIC_AGENTTRACE_WS_URL.
const isDev = process.env.NODE_ENV === "development"
const backend = process.env.AGENTTRACE_DEV_BACKEND ?? "http://127.0.0.1:3000"

const nextConfig: NextConfig = {
  reactStrictMode: false,
  ...(isDev
    ? {
        async rewrites() {
          return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }]
        },
      }
    : { output: "export", images: { unoptimized: true } }),
}

export default nextConfig
```

- [ ] **Step 3: `package.json` and lockfile**

- `"name": "agenttrace-ui"`.
- scripts:
```json
"dev": "next dev -p 3001",
"build": "next build",
"build:ui": "next build && node scripts/copy-ui.mjs",
"lint": "eslint .",
"typecheck": "tsc --noEmit"
```
- Remove dependencies: `@prisma/adapter-pg`, `@prisma/client`, `bcryptjs`, `next-auth`, `next-themes`, `pg`, `prisma`, `sharp`, `socket.io`, `socket.io-client`; devDependencies `@types/bcryptjs`, `@types/pg`, `dotenv`. Then check each remaining dependency is still imported somewhere (`grep -rn "from \"<pkg>" src`): remove `zod`, `react-resizable-panels`, `date-fns` and any Radix package if unused.
- Add `geist` (`bun add geist`).
- `bun install` to refresh `bun.lock`.

`scripts/copy-ui.mjs`:
```js
// Copy the static export (out/) into the Python package so the wheel ships
// the dashboard: python-server/agenttrace/server/static/.
import { cpSync, existsSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const src = join(root, "out")
const dest = join(root, "python-server", "agenttrace", "server", "static")

if (!existsSync(join(src, "index.html"))) {
  console.error("out/index.html not found — did `next build` run with output: export?")
  process.exit(1)
}
rmSync(dest, { recursive: true, force: true })
cpSync(src, dest, { recursive: true })
console.log(`[agenttrace] UI bundle copied to ${dest}`)
```

- [ ] **Step 4: Layout, sonner, footer**

`layout.tsx`:
```tsx
import type { Metadata } from "next"
import { GeistSans } from "geist/font/sans"
import { GeistMono } from "geist/font/mono"
import "./globals.css"
import { Providers } from "@/components/providers"

export const metadata: Metadata = {
  title: "AgentTrace — agent observability",
  description:
    "Watch autonomous and multi-agent systems run in real time. A live sequence diagram for AI engineers debugging agents.",
  keywords: ["agent observability", "tracing", "LLM", "sequence diagram", "AI agents"],
  icons: { icon: "/logo.svg" },
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${GeistSans.variable} ${GeistMono.variable} antialiased bg-background text-foreground min-h-screen`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
```
and in `globals.css` map `--font-sans`/`--font-mono` to `var(--font-geist-sans)` / `var(--font-geist-mono)` (the `geist` package exposes those CSS variable names — verify in `node_modules/geist/dist/*.d.ts`/source and adjust if different).

`components/ui/sonner.tsx`: drop `next-themes` (`useTheme`); default `theme="dark"`.
`footer.tsx`: replace "socket.io :3003" with "live · /ws".

- [ ] **Step 5: Type errors to zero**

Run `bun run typecheck`. Fix every remaining error (the Task 0 baseline) with minimal, local type fixes — no behaviour changes, no `// @ts-ignore` / `any` casts unless the value is genuinely untyped JSON (then prefer a named interface). List the fixes in the report.

- [ ] **Step 6: Verify the build**

```bash
bun run lint && bun run typecheck && bun run build:ui
command ls python-server/agenttrace/server/static | head
.venv/bin/pytest python-server/tests -q
```
Expected: lint/typecheck clean; `static/` contains `index.html` and `_next`; Python suite passes. Then a quick smoke: from `/tmp/claude-1000/ui-smoke`, `timeout 8 ../../../home/ibrahim/Bureau/agenttrace/.venv/bin/agenttrace ui --port 3999 &` (or any free port), `curl -s localhost:3999/ | grep -o "<title>[^<]*"` → the AgentTrace title; stop the server; delete the temp dir.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(ui): drop the Next.js backend; static export bundled into the Python package"
```

---

### Task 7: Integration and Settings views for the Python backend

**Files:**
- Modify: `src/components/views/integration-view.tsx`, `src/components/views/settings-view.tsx`

**Interfaces:**
- Consumes: `useSession()` (`authMode`, `version`), `api()`, `POST /api/seed` → `{seeded}`.

- [ ] **Step 1: Integration view**

- `const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000"`; every snippet uses `${origin}` (no hard-coded `localhost:3000`).
- `authMode === "none"`:
  - hide the key generation/list section and the "API key required" intro sentence; intro says ingestion needs no key in local mode and runs are grouped by project name;
  - tabs: **Python SDK**
```python
# pip install deepagents-trace
import agenttrace

agenttrace.set_tracking_uri("${origin}")
agenttrace.set_project("${projectName}")

with agenttrace.start_run("my run"):
    agenttrace.log_event(source="Orchestrator", target="LLM", type="llm_call", label="classify intent")
```
    **HTTP** (no Authorization header, `"project": "${projectName}"` in the create body; then events and `endRun` as today), **DeepAgents**
```python
# pip install 'deepagents-trace[langchain]'
import agenttrace, agenttrace.langchain

agenttrace.set_tracking_uri("${origin}")
agenttrace.set_project("${projectName}")
agenttrace.langchain.autolog()   # every agent.invoke() becomes a run
```
- `authMode === "password"`: keep the key flow; snippets use `AGENTTRACE_TRACKING_URI="${origin}"` + `AGENTTRACE_KEY="${apiKey}"` for the SDK/DeepAgents tabs and `Authorization: Bearer ${apiKey}` for HTTP; drop `pip install agenttrace-langchain` / `integrations/...` references.
- Endpoint reference table: only `POST /api/events` (create run, append event, end run). Keep the event body schema.
- Keep the TypeScript tab only for HTTP (fetch), mode-aware like the HTTP tab.

- [ ] **Step 2: Settings view**

- "Reload demo projects" button → `api<{ seeded: number }>("/api/seed", { method: "POST" })`; toast `seeded ? "Loaded N demo projects" : "Demo projects already present (only added when you have no projects)"`; invalidate `["projects"]` and `["stats"]`.
- Replace "v1.0.0 · socket.io :3003 · next-auth · prisma" with `` `v${version} · FastAPI · live /ws` ``.
- (Local-mode Account note is from Task 4 — keep it.)

- [ ] **Step 3: Verify**

`bun run lint && bun run typecheck && bun run build:ui` → clean. `grep -rn "localhost:3000\|agenttrace-langchain\|socket.io\|next-auth" src` → no output (except comments explaining dev defaults, if any).

- [ ] **Step 4: Commit**

```bash
git add -A src
git commit -m "feat(ui): integration snippets for the Python SDK, local-mode aware; settings seed + version"
```

---

### Task 8: Docker, compose, CI and publish workflows

**Files:**
- Rewrite: `Dockerfile`, `docker-compose.yml`, `.env.example`
- Modify: `.dockerignore`, `.github/workflows/ci.yml`, `.github/workflows/publish-pypi.yml`

- [ ] **Step 1: Dockerfile**

```dockerfile
# AgentTrace — single image: the Python package (FastAPI API + /ws) serving
# the static dashboard built in the first stage. No Node at runtime.

FROM oven/bun:1.3 AS ui
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run build:ui

FROM python:3.12-slim AS app
WORKDIR /app
COPY python-server/ ./python-server/
COPY --from=ui /app/python-server/agenttrace/server/static ./python-server/agenttrace/server/static
RUN pip install --no-cache-dir "./python-server[server,postgres]"
EXPOSE 3000
# Non-loopback host => password mode (accounts + project API keys).
# Configure AGENTTRACE_SECRET and DATABASE_URL via the environment.
CMD ["agenttrace", "ui", "--host", "0.0.0.0", "--port", "3000"]
```
`.dockerignore`: remove entries that would exclude `python-server/` content needed by the build; make sure `python-server/.venv`, `**/__pycache__`, `python-server/agenttrace/server/static` (rebuilt in stage 1) and `node_modules` are excluded.

- [ ] **Step 2: docker-compose.yml**

```yaml
# AgentTrace — docker-compose: Postgres + the AgentTrace Python server.
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-agenttrace}
      POSTGRES_USER: ${POSTGRES_USER:-agenttrace}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-agenttrace}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-agenttrace} -d ${POSTGRES_DB:-agenttrace}"]
      interval: 5s
      timeout: 5s
      retries: 10
    restart: unless-stopped

  agenttrace:
    build: .
    image: agenttrace:latest
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql+psycopg://${POSTGRES_USER:-agenttrace}:${POSTGRES_PASSWORD:-agenttrace}@db:5432/${POSTGRES_DB:-agenttrace}
      AGENTTRACE_SECRET: ${AGENTTRACE_SECRET:?set AGENTTRACE_SECRET (openssl rand -base64 32)}
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped

volumes:
  pgdata:
```
`.env.example`: `AGENTTRACE_SECRET=`, `POSTGRES_*`, and a comment listing the Python server variables (`DATABASE_URL`, `AGENTTRACE_AUTH`, `AGENTTRACE_ALLOWED_HOSTS`); remove NextAuth/socket variables.

- [ ] **Step 3: CI (`.github/workflows/ci.yml`)**

Replace the Node `quality` job with `ui`:
```yaml
  ui:
    name: ui · lint · typecheck · build
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3
      - run: bun install --frozen-lockfile
      - run: bun run lint
      - run: bun run typecheck
      - run: bun run build:ui
        env:
          NEXT_TELEMETRY_DISABLED: "1"
      - uses: actions/upload-artifact@v4
        with:
          name: ui-bundle
          path: python-server/agenttrace/server/static
```
`python` job: `needs: ui`; add before install:
```yaml
      - uses: actions/download-artifact@v4
        with:
          name: ui-bundle
          path: python-server/agenttrace/server/static
```
and after the tests:
```yaml
      - name: Wheel ships the UI
        run: |
          uv build python-server --wheel --out-dir dist
          .venv/bin/python python-server/scripts/check_wheel.py dist/*.whl
```
`docker` job: build the single image (`docker/build-push-action`, no `target`, tag `agenttrace:ci`), then smoke test: start Postgres on a network, run the image with `DATABASE_URL=postgresql+psycopg://...@pg:5432/agenttrace` and `AGENTTRACE_SECRET=ci-secret`, wait for `curl -sf http://localhost:3000/` to return 200, assert `curl -s localhost:3000/ | grep -q "<title>AgentTrace"` and `curl -sf localhost:3000/api/auth/session | grep -q '"authMode":"password"'`. Remove the socket image and its smoke test. Update the header comment.

- [ ] **Step 4: Publish workflow**

In `publish-pypi.yml` `build` job, before `python -m build`:
```yaml
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3
      - run: bun install --frozen-lockfile
        working-directory: .
      - run: bun run build:ui
        working-directory: .
        env:
          NEXT_TELEMETRY_DISABLED: "1"
```
and after it: `- run: python scripts/check_wheel.py dist/*.whl`.

- [ ] **Step 5: Verify**

`python -c "import yaml,sys; [yaml.safe_load(open(f)) for f in sys.argv[1:]]" .github/workflows/ci.yml .github/workflows/publish-pypi.yml docker-compose.yml` (use `.venv/bin/python`; install `pyyaml` into the venv if missing) → no error. If Docker is available locally: `docker build -t agenttrace:local .` and the same smoke test; if not, say so in the report (CI covers it).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "build: single Python Docker image with bundled UI; CI builds UI before the wheel"
```

---

### Task 9: End-to-end test (Playwright)

**Files:**
- Create: `python-server/tests_e2e/conftest.py`, `python-server/tests_e2e/test_dashboard.py`
- Modify: `.github/workflows/ci.yml` (job `e2e`)

**Interfaces:**
- Consumes: installed `agenttrace` with bundle (`static/index.html` present), `agenttrace demo`, `agenttrace ui`, `agenttrace.AgentTraceClient`.

- [ ] **Step 1: Fixtures**

`python-server/tests_e2e/conftest.py`:
```python
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
pytestmark = pytest.mark.skipif(not BUNDLE.is_file(), reason="UI bundle not built (bun run build:ui)")


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
```
(`python -m agenttrace.cli` works because `cli.py` ends with `if __name__ == "__main__": main()`.)

- [ ] **Step 2: Tests**

`python-server/tests_e2e/test_dashboard.py` — use Playwright's `page` fixture and `expect`. Choose locators by reading the components (prefer `get_by_role` / `get_by_text`; add a `data-testid` to a component only where text is ambiguous, and list such additions in the report):
```python
from playwright.sync_api import Page, expect

from agenttrace import AgentTraceClient


def test_local_mode_dashboard_and_live_event(page: Page, local_server):
    base, db_url = local_server
    page.goto(base)
    # no login screen in local mode; demo projects listed
    expect(page.get_by_text("Customer Support Agent").first).to_be_visible(timeout=15_000)
    expect(page.get_by_text("Research Assistant").first).to_be_visible()
    expect(page.get_by_text("Code Review Bot").first).to_be_visible()

    client = AgentTraceClient(db_url)
    run_id = client.create_run("e2e live run", project="Customer Support Agent")
    client.log_event(run_id, source="Orchestrator", target="LLM", type="llm_call", label="first step")

    # navigate: project → run (adapt the clicks to the actual UI)
    page.get_by_text("Customer Support Agent").first.click()
    page.get_by_text("e2e live run").first.click()
    expect(page.get_by_text("first step").first).to_be_visible(timeout=10_000)

    client.log_event(run_id, source="Orchestrator", target="web_search", type="tool_call", label="live arrow")
    expect(page.get_by_text("live arrow").first).to_be_visible(timeout=5_000)


def test_password_mode_signup_and_sign_out(page: Page, password_server):
    base, _ = password_server
    page.goto(base)
    # auth screen → switch to sign-up, fill, submit (adapt labels to auth-screen.tsx)
    page.get_by_role("tab", name="Create account").click()
    page.get_by_label("Name").fill("E2E User")
    page.get_by_label("Email").fill("e2e@example.com")
    page.get_by_label("Password").fill("secret123")
    page.get_by_role("button", name="Create account").click()
    expect(page.get_by_text("E2E User").first).to_be_visible(timeout=10_000)
    # sign out (sidebar or settings) → back to the auth screen
    page.get_by_role("button", name="Sign out").first.click()
    expect(page.get_by_role("tab", name="Create account")).to_be_visible(timeout=10_000)
```

- [ ] **Step 3: Run locally (if possible)**

```bash
uv pip install --python .venv -e "python-server[dev,e2e]"
.venv/bin/playwright install chromium
bun run build:ui
.venv/bin/pytest python-server/tests_e2e -q
```
Expected: 2 passed. If the browser download is impossible here, report it and rely on CI.

- [ ] **Step 4: CI job**

```yaml
  e2e:
    name: e2e (playwright)
    runs-on: ubuntu-latest
    needs: ui
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v6
      - uses: actions/download-artifact@v4
        with:
          name: ui-bundle
          path: python-server/agenttrace/server/static
      - name: Install
        run: |
          uv venv .venv --python 3.12
          uv pip install --python .venv "python-server[dev,e2e]"
          .venv/bin/playwright install --with-deps chromium
      - name: E2E
        run: .venv/bin/pytest python-server/tests_e2e -q
```
(non-editable install so the test uses the packaged bundle path.)

- [ ] **Step 5: Commit**

```bash
git add -A python-server/tests_e2e .github/workflows/ci.yml src
git commit -m "test: Playwright e2e for the bundled dashboard (local live updates, password signup)"
```

---

### Task 10: Documentation

**Files:**
- Modify: `README.md`, `python-server/README.md`, `docs/user-manual.md`, `docs/functional-documentation.md` (pointer notes only)

- [ ] **Step 1: README.md** — rewrite the top-level guide around the Python package:
  - Stack section: static Next.js export (build tool only) + FastAPI backend; remove Prisma/NextAuth/Socket.IO/Caddy/Bun-runtime mentions.
  - Quick start: `pip install 'deepagents-trace[server]'`, `agenttrace demo`, `agenttrace ui` (open http://127.0.0.1:3000).
  - Docker: `AGENTTRACE_SECRET=... docker compose up --build` (Postgres + single image, password mode).
  - Development: backend `pip install -e "python-server[dev]"` + `agenttrace ui --auth none`; UI `bun install` + `NEXT_PUBLIC_AGENTTRACE_WS_URL=ws://localhost:3000/ws bun run dev` (http://localhost:3001); `bun run build:ui` to refresh the bundled UI.
  - CI section: jobs ui / python / e2e / docker.
  - Project structure: updated tree (no `src/app/api`, `prisma/`, `mini-services/`).
  - Keep the instrumentation / event API sections, updated to the SDK.
- [ ] **Step 2: python-server/README.md** — drop "Phase 2 not done"/placeholder wording; document `agenttrace demo`, the bundled UI, where the bundle comes from (CI / `bun run build:ui` for source installs), and add to "Upgrading from 0.1": the Next.js backend is gone and data from an old Prisma database is not migrated (start a fresh FastAPI database).
- [ ] **Step 3: docs/** — add a one-paragraph note at the top of `docs/user-manual.md` and `docs/functional-documentation.md` that they describe the pre-0.2 Next.js deployment where they mention NextAuth/Prisma/Socket.IO, pointing to the README (don't rewrite these documents).
- [ ] **Step 4: Verify** — `grep -rn "next-auth\|prisma\|socket.io\|mini-services\|XTransformPort" README.md python-server/README.md` → only historical mentions in the upgrade notes.
- [ ] **Step 5: Commit**

```bash
git add README.md python-server/README.md docs
git commit -m "docs: bundled dashboard, agenttrace demo, Docker and dev loop"
```
