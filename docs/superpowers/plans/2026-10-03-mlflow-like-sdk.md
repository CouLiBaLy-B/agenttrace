# MLflow-like SDK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `deepagents-trace` usable like MLflow: one package, a fluent `agenttrace.*` API, zero-config local SQLite storage, keyless local server, and `agenttrace.langchain.autolog()`.

**Architecture:** A tracking URI selects a `TrackingStore` (`SqlStore` writes straight to the database through the server's SQLAlchemy models; `RestStore` posts to `/api/events`). `ActiveRun` wraps a store with the existing non-blocking / never-fatal queue+thread contract. A fluent layer keeps an active-run stack in a `ContextVar`. The server gains `--auth none` (local user, project auto-created by name) and a DB poller as the single live-broadcast path, so direct SQLite writes appear live. LangChain autolog is a global callback handler registered with `register_configure_hook`.

**Tech Stack:** Python ≥3.10, SQLAlchemy 2, requests, click, FastAPI/uvicorn (extra), langchain-core ≥1.0 (extra), pytest, pytest-asyncio, pytest-mock, uv.

**Spec:** `docs/superpowers/specs/2026-10-03-mlflow-like-sdk-design.md`

## Global Constraints

- Distribution name stays `deepagents-trace`; import package `agenttrace`; package root is `python-server/`.
- Core dependencies only: `sqlalchemy>=2.0`, `requests>=2.31`, `click>=8.1`. Server deps go in `[server]`, LangChain in `[langchain]`.
- `POST /api/events` stays backward compatible: every existing request with an `atr_` key behaves exactly as before.
- Event types are exactly: `llm_call`, `tool_call`, `tool_result`, `handoff`, `error`, `final_answer`.
- Default tracking URI: `sqlite:///./agenttrace.db`. Default project: `"Default"`.
- Env vars: `AGENTTRACE_TRACKING_URI`, `AGENTTRACE_PROJECT`, `AGENTTRACE_KEY`, `AGENTTRACE_URL` (legacy fallback, `/api/events` suffix stripped), `AGENTTRACE_AUTH` (`none` | `password`, server side; unset means `password`).
- Local user email: `local@agenttrace`.
- Tracing never raises into the caller except `ValueError` for an invalid event type; `AgentTraceClient` (explicit API) is fail-loud by design.
- Existing tests of both packages must still pass (moved, imports updated).
- Code style: match the existing modules — module docstring explaining *why*, `from __future__ import annotations`, comments only where non-obvious.

## Review Focus

1. **Short script exits before the worker drains** — `log_event()` then the interpreter exits: the events and the `completed` status must reach the DB (atexit hook). Test in Task 5 (subprocess).
2. **Client writes SQLite while `agenttrace ui` reads the same file** — two processes, same file: no "database is locked" crash; SQLite `timeout=30` connect arg. Test in Task 1 (two engines on one file, concurrent write+read).
3. **First run ever on a fresh DB from two writers** — server and client both create the `local` user/project at once: unique-email race must not fail. Test in Task 2 (IntegrityError path).
4. **`autolog()` called, agent invoked from a worker thread** (e.g. FastAPI threadpool) — must still be traced. Test in Task 10.
5. **Keyless client against a password-mode server** — the warning must point to `AGENTTRACE_KEY`, the agent keeps running. Test in Task 4.

---

## File Structure

```
python-server/
  pyproject.toml                         MODIFY  deps/extras, version 0.2.0, pytest config
  agenttrace/
    __init__.py                          MODIFY  public fluent API
    cli.py                               MODIFY  --auth, missing-extra hint
    store/
      __init__.py                        CREATE  (empty docstring)
      models.py                          MOVE    from server/models.py (unchanged)
      db.py                              CREATE  cached engines per URL
      events.py                          CREATE  shared create_run / append_event / close_run
      local.py                           CREATE  local user + project find-or-create
    tracking/
      __init__.py                        CREATE  (empty docstring)
      _uri.py                            CREATE  tracking URI resolution
      stores/__init__.py                 CREATE  store_for_uri()
      stores/base.py                     CREATE  TrackingStore ABC
      stores/sql.py                      CREATE  SqlStore
      stores/rest.py                     CREATE  RestStore
      run.py                             CREATE  ActiveRun, truncate/compact, atexit
      fluent.py                          CREATE  module-level API + trace decorator
      client.py                          CREATE  AgentTraceClient (explicit)
      http.py                            MOVE    legacy HTTP client -> HttpEventClient + AgentTraceRun
      async_http.py                      MOVE    legacy async client -> AsyncHttpEventClient
      async_run.py                       MOVE    AsyncAgentTraceRun (unchanged logic)
    langchain/
      __init__.py                        CREATE  autolog, middleware, callback exports
      middleware.py                      MOVE    from integrations, now store-based
      callback.py                        CREATE  AgentTraceCallbackHandler
      autolog.py                         CREATE  autolog()
    server/
      models.py                          MODIFY  re-export agenttrace.store.models
      db.py                              MODIFY  thin wrapper over agenttrace.store.db
      deps.py                            MODIFY  auth mode, local user
      realtime.py                        MODIFY  DB poller, remove direct broadcast
      app.py                             MODIFY  start/stop poller
      routes/events.py                   MODIFY  shared helpers, keyless ingestion
  tests/
    conftest.py                          MODIFY  shared fixtures (tracking_db, read helpers)
    test_api.py                          (unchanged, must keep passing)
    test_cli.py                          CREATE
    test_server_local_mode.py            CREATE
    test_realtime_poller.py              CREATE
    store/test_db.py, store/test_events.py                       CREATE
    tracking/test_uri.py, test_stores.py, test_run.py,
             test_fluent.py, test_client.py, test_legacy_http.py,
             test_async_run.py                                   CREATE / MOVED
    langchain/test_middleware.py (moved), test_callback.py, test_autolog.py  CREATE / MOVED
integrations/agenttrace-langchain/
  agenttrace_langchain/__init__.py       MODIFY  shim re-exports + DeprecationWarning
  agenttrace_langchain/{client,async_client,run,async_run,middleware}.py  DELETE
  tests/*                                DELETE (moved) ; tests/test_shim.py CREATE
  pyproject.toml                         MODIFY  depends on deepagents-trace[langchain]
.github/workflows/ci.yml                 MODIFY  python job
README.md, python-server/README.md, integrations/agenttrace-langchain/README.md  MODIFY
```

All commands run from the repo root `/home/ibrahim/Bureau/agenttrace`. The test runner is `.venv/bin/pytest` (created in Task 1). **Never pass both test directories to one pytest invocation**: pytest would pick its config from the repo root (none), losing `asyncio_mode = "auto"`. Run `python-server/tests` and `integrations/agenttrace-langchain/tests` as two separate commands.

---

### Task 1: Package restructure — shared store, extras, CLI hint

**Files:**
- Move: `python-server/agenttrace/server/models.py` → `python-server/agenttrace/store/models.py`
- Create: `python-server/agenttrace/store/__init__.py`, `python-server/agenttrace/store/db.py`, `python-server/agenttrace/server/models.py` (re-export)
- Modify: `python-server/agenttrace/server/db.py`, `python-server/pyproject.toml`, `python-server/agenttrace/cli.py`
- Test: `python-server/tests/store/test_db.py`, `python-server/tests/test_cli.py`

**Interfaces:**
- Produces: `agenttrace.store.db.DEFAULT_SQLITE_URL: str`, `database_url() -> str`, `get_engine(url: str) -> Engine`, `get_sessionmaker(url: str) -> sessionmaker`, `init_db(url: str) -> None`; `agenttrace.store.models.{Base, User, Project, Run, Event, ApiKey}`; `agenttrace.server.db.{engine, SessionLocal, get_db, init_db}` unchanged names.

- [ ] **Step 1: Create the dev environment and record the baseline**

```bash
uv venv .venv --python 3.12
uv pip install --python .venv -e "python-server[dev]" -e "integrations/agenttrace-langchain[dev]" pytest-mock pytest-asyncio
.venv/bin/pytest integrations/agenttrace-langchain/tests -q
.venv/bin/pytest python-server/tests -q
```
Expected: all existing tests pass (server ≈ 9, langchain 32). If any fail, stop and report — the baseline must be green.

- [ ] **Step 2: Write the failing tests**

`python-server/tests/store/__init__.py`: empty file. Also create empty `python-server/tests/__init__.py` only if pytest complains about duplicate basenames (it will once `tests/tracking/test_run.py` and others exist — create `__init__.py` in `tests/`, `tests/store/`, `tests/tracking/`, `tests/langchain/` now).

`python-server/tests/store/test_db.py`:
```python
import threading

from sqlalchemy import text

from agenttrace.store import db as store_db
from agenttrace.store import models


def test_get_engine_is_cached_per_url(tmp_path):
    url = f"sqlite:///{tmp_path}/a.db"
    assert store_db.get_engine(url) is store_db.get_engine(url)
    assert store_db.get_engine(url) is not store_db.get_engine(f"sqlite:///{tmp_path}/b.db")


def test_init_db_creates_all_tables(tmp_path):
    url = f"sqlite:///{tmp_path}/c.db"
    store_db.init_db(url)
    with store_db.get_engine(url).connect() as conn:
        names = {row[0] for row in conn.execute(text("select name from sqlite_master where type='table'"))}
    assert {"users", "projects", "runs", "events", "api_keys"} <= names


def test_server_models_are_the_store_models():
    from agenttrace.server import models as server_models

    assert server_models.Event is models.Event
    assert server_models.Base is models.Base


def test_concurrent_writer_and_reader_on_same_sqlite_file(tmp_path):
    """Review focus #2: the SDK writes while `agenttrace ui` reads the same file."""
    url = f"sqlite:///{tmp_path}/shared.db"
    store_db.init_db(url)
    writer = store_db.get_engine(url)
    from sqlalchemy import create_engine

    reader = create_engine(url, connect_args={"check_same_thread": False, "timeout": 30})
    errors = []

    def write():
        try:
            for i in range(200):
                with writer.begin() as conn:
                    conn.execute(
                        text("insert into users (id, email, createdAt, updatedAt) values (:i, :e, datetime(), datetime())"),
                        {"i": f"u{i}", "e": f"u{i}@x"},
                    )
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)

    thread = threading.Thread(target=write)
    thread.start()
    for _ in range(200):
        with reader.connect() as conn:
            conn.execute(text("select count(*) from users")).scalar()
    thread.join()
    assert errors == []
```

`python-server/tests/test_cli.py`:
```python
import importlib.util

from click.testing import CliRunner

from agenttrace import cli


def test_ui_without_server_extra_exits_with_install_hint(monkeypatch):
    real_find_spec = importlib.util.find_spec
    monkeypatch.setattr(
        importlib.util, "find_spec", lambda name, *a: None if name == "fastapi" else real_find_spec(name, *a)
    )
    result = CliRunner().invoke(cli.main, ["ui"])
    assert result.exit_code == 1
    assert "pip install 'deepagents-trace[server]'" in result.output
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `.venv/bin/pytest python-server/tests/store/test_db.py python-server/tests/test_cli.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'agenttrace.store'` and CLI test fails (exit code 0 or uvicorn started — if uvicorn would actually start, the test hangs: implement Step 4's CLI change before re-running if needed).

- [ ] **Step 4: Implement**

```bash
mkdir -p python-server/agenttrace/store
git mv python-server/agenttrace/server/models.py python-server/agenttrace/store/models.py
```

`python-server/agenttrace/store/__init__.py`:
```python
"""Persistence layer shared by the server and the SDK's SqlStore."""
```

`python-server/agenttrace/store/db.py`:
```python
"""Engine/session factories shared by the server and the SDK.

The server used to build one module-level engine from DATABASE_URL. The SDK
needs to target whatever tracking URI the user picked (MLflow-style), so
engines are cached per URL instead. SQLite gets a 30 s busy timeout because
the SDK and `agenttrace ui` routinely hold the same file open from two
processes.
"""

from __future__ import annotations

import os
import threading

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import sessionmaker

DEFAULT_SQLITE_URL = "sqlite:///./agenttrace.db"

_lock = threading.Lock()
_engines: dict[str, Engine] = {}
_sessionmakers: dict[str, sessionmaker] = {}


def database_url() -> str:
    return os.getenv("DATABASE_URL", DEFAULT_SQLITE_URL)


def get_engine(url: str) -> Engine:
    with _lock:
        engine = _engines.get(url)
        if engine is None:
            connect_args = {"check_same_thread": False, "timeout": 30} if url.startswith("sqlite") else {}
            engine = create_engine(url, connect_args=connect_args)
            _engines[url] = engine
        return engine


def get_sessionmaker(url: str) -> sessionmaker:
    engine = get_engine(url)
    with _lock:
        factory = _sessionmakers.get(url)
        if factory is None:
            factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
            _sessionmakers[url] = factory
        return factory


def init_db(url: str) -> None:
    """Create all tables if they don't exist yet (schema-push style)."""
    from . import models

    models.Base.metadata.create_all(bind=get_engine(url))
```

`python-server/agenttrace/server/models.py`:
```python
"""Models moved to `agenttrace.store.models` so the SDK can write to the
database without importing FastAPI. Re-exported here for the routes."""

from ..store.models import ApiKey, Base, Event, Project, Run, User  # noqa: F401
```

Replace `python-server/agenttrace/server/db.py` body (keep the existing docstring, append one sentence: "Engines now come from `agenttrace.store.db`, cached per URL."):
```python
from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy.orm import Session

from ..store.db import DEFAULT_SQLITE_URL, database_url, get_engine, get_sessionmaker  # noqa: F401
from ..store.db import init_db as _init_db

engine = get_engine(database_url())
SessionLocal = get_sessionmaker(database_url())


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """Create all tables if they don't exist yet (schema-push style)."""
    _init_db(database_url())
```

`python-server/pyproject.toml` — replace `dependencies` and `[project.optional-dependencies]`, add pytest config:
```toml
dependencies = [
    "sqlalchemy>=2.0",
    "requests>=2.31",
    "click>=8.1",
]

[project.optional-dependencies]
server = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.30",
    "bcrypt>=4.0",
    "itsdangerous>=2.2",
    "websockets>=13.0",
]
langchain = ["langchain>=1.0.0", "langchain-core>=1.0.0", "httpx>=0.27"]
dev = [
    "deepagents-trace[server,langchain]",
    "pytest>=8.0",
    "pytest-asyncio>=0.24",
    "pytest-mock>=3.14",
    "httpx>=0.27",
]

[tool.pytest.ini_options]
asyncio_mode = "auto"
```
Also set `version = "0.2.0"` now (the shim in Task 9 depends on `deepagents-trace>=0.2.0` resolving to this checkout), and update `description` to: `"AgentTrace - observability for AI agents, MLflow-style: fluent tracking API, local SQLite by default, `agenttrace ui` for the live dashboard."`

`python-server/agenttrace/cli.py` — add at top-level and call first thing in `ui`:
```python
import importlib.util
import sys

def _require_server_extra() -> None:
    if importlib.util.find_spec("fastapi") is None or importlib.util.find_spec("uvicorn") is None:
        click.echo("[AgentTrace] The server isn't installed: pip install 'deepagents-trace[server]'", err=True)
        sys.exit(1)
```
`CliRunner` mixes stderr into `result.output` by default (click ≥8.2 `output` includes both); if the installed click separates them, assert on `result.output + (result.stderr or "")`.

Reinstall so the new extras resolve: `uv pip install --python .venv -e "python-server[dev]"`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `.venv/bin/pytest python-server/tests -q`
Expected: PASS (new + all existing server tests).

- [ ] **Step 6: Commit**

```bash
git add -A python-server
git commit -m "refactor: move models to agenttrace.store, add per-URL engines and [server] extra"
```

---

### Task 2: Shared event-writing logic + local user/project

**Files:**
- Create: `python-server/agenttrace/store/events.py`, `python-server/agenttrace/store/local.py`
- Modify: `python-server/agenttrace/server/routes/events.py`
- Test: `python-server/tests/store/test_events.py`

**Interfaces:**
- Consumes: `agenttrace.store.db.{init_db, get_sessionmaker}`, `agenttrace.store.models`.
- Produces:
  - `agenttrace.store.events.VALID_EVENT_TYPES: frozenset[str]`
  - `create_run(db: Session, project_id: str, name: str) -> models.Run`
  - `append_event(db: Session, run_id: str, body: dict) -> models.Event` (wire names: `source,target,type,label,payload,durationMs,status`)
  - `close_run(db: Session, run: models.Run, end_status: str) -> models.Run` (`"failed"` → failed, anything else → completed)
  - `agenttrace.store.local.LOCAL_USER_EMAIL = "local@agenttrace"`, `get_or_create_local_user(db) -> models.User`, `get_or_create_project(db, user: models.User, name: str) -> models.Project`

- [ ] **Step 1: Write the failing tests**

`python-server/tests/store/test_events.py`:
```python
import pytest
from sqlalchemy.exc import IntegrityError

from agenttrace.store import db as store_db
from agenttrace.store import events, local, models


@pytest.fixture
def session(tmp_path):
    url = f"sqlite:///{tmp_path}/events.db"
    store_db.init_db(url)
    with store_db.get_sessionmaker(url)() as db:
        yield db


def test_local_user_and_project_are_created_once(session):
    user = local.get_or_create_local_user(session)
    assert user.email == local.LOCAL_USER_EMAIL
    assert local.get_or_create_local_user(session).id == user.id

    project = local.get_or_create_project(session, user, "support-bot")
    assert local.get_or_create_project(session, user, "support-bot").id == project.id
    assert local.get_or_create_project(session, user, "other").id != project.id


def test_local_user_survives_unique_email_race(session, monkeypatch):
    """Review focus #3: another process inserted the local user between our
    SELECT and INSERT — we must re-read instead of failing."""
    other = models.User(email=local.LOCAL_USER_EMAIL)
    session.add(other)
    session.commit()

    real_query = session.query
    calls = {"n": 0}

    def first_lookup_misses(*args, **kwargs):
        q = real_query(*args, **kwargs)
        calls["n"] += 1
        if calls["n"] == 1:
            return real_query(models.User).filter(models.User.email == "nobody@nowhere")
        return q

    monkeypatch.setattr(session, "query", first_lookup_misses)
    user = local.get_or_create_local_user(session)
    assert user.id == other.id


def test_append_event_assigns_increasing_seq_and_defaults(session):
    user = local.get_or_create_local_user(session)
    project = local.get_or_create_project(session, user, "p")
    run = events.create_run(session, project.id, "r")
    assert run.status == "running"

    first = events.append_event(session, run.id, {"source": "A", "target": "B", "type": "tool_call"})
    second = events.append_event(
        session, run.id, {"source": "B", "target": "A", "type": "error", "payload": {"x": 1}, "durationMs": 7}
    )
    assert (first.seq, second.seq) == (0, 1)
    assert first.status == "ok" and first.payload == "{}"
    assert second.status == "error" and second.payload == '{"x": 1}' and second.duration_ms == 7


def test_close_run_maps_status(session):
    user = local.get_or_create_local_user(session)
    project = local.get_or_create_project(session, user, "p")
    run = events.close_run(session, events.create_run(session, project.id, "r"), "failed")
    assert run.status == "failed" and run.ended_at is not None
    run2 = events.close_run(session, events.create_run(session, project.id, "r2"), "whatever")
    assert run2.status == "completed"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/pytest python-server/tests/store/test_events.py -q`
Expected: FAIL — `ImportError: cannot import name 'events' from 'agenttrace.store'`.

- [ ] **Step 3: Implement**

`python-server/agenttrace/store/events.py`:
```python
"""Event/run writes shared by `POST /api/events` and the SDK's SqlStore, so
both write paths assign `seq`, default `status` and encode `payload`
identically."""

from __future__ import annotations

import json
from datetime import datetime, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from . import models

VALID_EVENT_TYPES = frozenset({"llm_call", "tool_call", "tool_result", "handoff", "error", "final_answer"})


def create_run(db: Session, project_id: str, name: str) -> models.Run:
    run = models.Run(project_id=project_id, name=name, status="running")
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


def append_event(db: Session, run_id: str, body: dict) -> models.Event:
    """`body` uses the wire field names; the caller validated source/target/type."""
    seq = db.query(func.count(models.Event.id)).filter(models.Event.run_id == run_id).scalar()
    type_ = str(body["type"])
    payload = body.get("payload") if body.get("payload") is not None else {}
    event = models.Event(
        run_id=run_id,
        seq=seq,
        source=str(body["source"]),
        target=str(body["target"]),
        type=type_,
        label=str(body["label"]) if body.get("label") else None,
        payload=json.dumps(payload),
        duration_ms=int(body["durationMs"]) if body.get("durationMs") is not None else None,
        status=body.get("status") or ("error" if type_ == "error" else "ok"),
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def close_run(db: Session, run: models.Run, end_status: str) -> models.Run:
    run.status = "failed" if end_status == "failed" else "completed"
    run.ended_at = datetime.now(timezone.utc)
    db.commit()
    return run
```

`python-server/agenttrace/store/local.py`:
```python
"""The single `local` user that owns everything written without an account:
SDK writes to SQLite, and the server in `--auth none` mode. Projects are
found or created by name, like MLflow experiments."""

from __future__ import annotations

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import models

LOCAL_USER_EMAIL = "local@agenttrace"


def get_or_create_local_user(db: Session) -> models.User:
    user = db.query(models.User).filter(models.User.email == LOCAL_USER_EMAIL).first()
    if user:
        return user
    user = models.User(email=LOCAL_USER_EMAIL, name="Local")
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        # Another process (SDK vs. `agenttrace ui`) created it first.
        db.rollback()
        return db.query(models.User).filter(models.User.email == LOCAL_USER_EMAIL).one()
    db.refresh(user)
    return user


def get_or_create_project(db: Session, user: models.User, name: str) -> models.Project:
    project = (
        db.query(models.Project)
        .filter(models.Project.user_id == user.id, models.Project.name == name)
        .order_by(models.Project.created_at)
        .first()
    )
    if project:
        return project
    project = models.Project(name=name, user_id=user.id)
    db.add(project)
    db.commit()
    db.refresh(project)
    return project
```

`python-server/agenttrace/server/routes/events.py` — replace the run creation, close and event creation blocks with the helpers (broadcast calls stay for now; Task 8 removes them):
```python
from ...store.events import VALID_EVENT_TYPES, append_event, close_run, create_run
```
- delete the local `VALID_EVENT_TYPES` and the `json`, `datetime`, `func` imports;
- creation: `run = create_run(db, project.id, name)`;
- end: `close_run(db, run, body["endRun"])`, then `manager.broadcast_run_update(run_id, {"status": run.status, "endedAt": run.ended_at.isoformat()})` and return `{"runId": run_id, "closed": True, "status": run.status}`;
- event: after the existing validation, `event = append_event(db, run_id, body)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/pytest python-server/tests -q`
Expected: PASS (incl. `test_events_ingestion_full_lifecycle`).

- [ ] **Step 5: Commit**

```bash
git add -A python-server
git commit -m "refactor: share event writes between ingestion route and SDK; add local user/project helpers"
```

---

### Task 3: Tracking URI resolution

**Files:**
- Create: `python-server/agenttrace/tracking/__init__.py`, `python-server/agenttrace/tracking/_uri.py`
- Test: `python-server/tests/tracking/test_uri.py`

**Interfaces:**
- Produces: `agenttrace.tracking._uri.DEFAULT_TRACKING_URI = "sqlite:///./agenttrace.db"`, `set_tracking_uri(uri: str | None) -> None`, `get_tracking_uri() -> str`, `is_http_uri(uri: str) -> bool`, `events_url(uri: str) -> str`.

- [ ] **Step 1: Write the failing tests**

`python-server/tests/tracking/test_uri.py`:
```python
import pytest

from agenttrace.tracking import _uri


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    for var in ("AGENTTRACE_TRACKING_URI", "AGENTTRACE_URL"):
        monkeypatch.delenv(var, raising=False)
    _uri.set_tracking_uri(None)
    yield
    _uri.set_tracking_uri(None)


def test_default_is_local_sqlite():
    assert _uri.get_tracking_uri() == "sqlite:///./agenttrace.db"


def test_resolution_order(monkeypatch):
    monkeypatch.setenv("AGENTTRACE_URL", "http://legacy:3000/api/events")
    assert _uri.get_tracking_uri() == "http://legacy:3000"
    monkeypatch.setenv("AGENTTRACE_TRACKING_URI", "http://env:3000")
    assert _uri.get_tracking_uri() == "http://env:3000"
    _uri.set_tracking_uri("sqlite:///explicit.db")
    assert _uri.get_tracking_uri() == "sqlite:///explicit.db"
    _uri.set_tracking_uri(None)
    assert _uri.get_tracking_uri() == "http://env:3000"


def test_events_url_and_http_detection():
    assert _uri.events_url("http://h:3000") == "http://h:3000/api/events"
    assert _uri.events_url("https://h/") == "https://h/api/events"
    assert _uri.events_url("http://h/api/events") == "http://h/api/events"
    assert _uri.is_http_uri("HTTPS://h") and not _uri.is_http_uri("sqlite:///x.db")
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/pytest python-server/tests/tracking/test_uri.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'agenttrace.tracking'`.

- [ ] **Step 3: Implement**

`python-server/agenttrace/tracking/__init__.py`:
```python
"""Client-side tracking: stores, runs and the fluent API."""
```

`python-server/agenttrace/tracking/_uri.py`:
```python
"""Tracking URI resolution, MLflow-style: explicit `set_tracking_uri()` >
AGENTTRACE_TRACKING_URI > legacy AGENTTRACE_URL (the full `/api/events` URL
the pre-0.2 client used) > local SQLite file."""

from __future__ import annotations

import os
from typing import Optional

DEFAULT_TRACKING_URI = "sqlite:///./agenttrace.db"
_EVENTS_PATH = "/api/events"

_tracking_uri: Optional[str] = None


def set_tracking_uri(uri: Optional[str]) -> None:
    global _tracking_uri
    _tracking_uri = uri or None


def get_tracking_uri() -> str:
    if _tracking_uri:
        return _tracking_uri
    env = os.getenv("AGENTTRACE_TRACKING_URI")
    if env:
        return env
    legacy = os.getenv("AGENTTRACE_URL")
    if legacy:
        return legacy.rstrip("/").removesuffix(_EVENTS_PATH)
    return DEFAULT_TRACKING_URI


def is_http_uri(uri: str) -> bool:
    return uri.lower().startswith(("http://", "https://"))


def events_url(uri: str) -> str:
    base = uri.rstrip("/")
    return base if base.endswith(_EVENTS_PATH) else base + _EVENTS_PATH
```

- [ ] **Step 4: Run to verify pass**

Run: `.venv/bin/pytest python-server/tests/tracking/test_uri.py -q` → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A python-server
git commit -m "feat: tracking URI resolution"
```

---

### Task 4: Tracking stores (SqlStore, RestStore)

**Files:**
- Create: `python-server/agenttrace/tracking/stores/__init__.py`, `stores/base.py`, `stores/sql.py`, `stores/rest.py`
- Test: `python-server/tests/tracking/test_stores.py`

**Interfaces:**
- Consumes: Task 1 `init_db`, `get_sessionmaker`; Task 2 `create_run`, `append_event`, `close_run`, `get_or_create_local_user`, `get_or_create_project`; Task 3 `is_http_uri`, `events_url`.
- Produces:
  - `TrackingStore` ABC: `create_run(project: str | None, name: str) -> str`, `log_event(run_id: str, event: dict) -> None`, `end_run(run_id: str, status: str) -> None`
  - `SqlStore(url: str)`
  - `RestStore(events_url: str, api_key: str | None = None, timeout: float = 10.0, session=None)` — `session` is anything with `.post(url, json=, headers=, timeout=)`; `None` means module-level `requests.post` (keeps legacy `mocker.patch("requests.post")` tests working).
  - `store_for_uri(uri: str) -> TrackingStore` (HTTP → `RestStore(events_url(uri), api_key=os.getenv("AGENTTRACE_KEY"))`, else `SqlStore(uri)`)

- [ ] **Step 1: Write the failing tests**

`python-server/tests/tracking/test_stores.py`:
```python
import pytest

from agenttrace.store import db as store_db
from agenttrace.store import models
from agenttrace.tracking.stores import store_for_uri
from agenttrace.tracking.stores.rest import RestStore
from agenttrace.tracking.stores.sql import SqlStore


def test_sql_store_round_trip(tmp_path):
    url = f"sqlite:///{tmp_path}/s.db"
    store = SqlStore(url)
    run_id = store.create_run("support-bot", "first")
    store.log_event(run_id, {"source": "Orchestrator", "target": "LLM", "type": "llm_call", "durationMs": 3})
    store.log_event(run_id, {"source": "Orchestrator", "target": "User", "type": "final_answer"})
    store.end_run(run_id, "completed")

    with store_db.get_sessionmaker(url)() as db:
        run = db.get(models.Run, run_id)
        assert run.status == "completed"
        assert run.project.name == "support-bot"
        assert run.project.user.email == "local@agenttrace"
        assert [e.type for e in run.events] == ["llm_call", "final_answer"]


def test_sql_store_reuses_project_by_name(tmp_path):
    store = SqlStore(f"sqlite:///{tmp_path}/s.db")
    a, b = store.create_run("p", "a"), store.create_run("p", "b")
    with store_db.get_sessionmaker(store.url)() as db:
        assert db.get(models.Run, a).project_id == db.get(models.Run, b).project_id


def test_sql_store_end_unknown_run_raises(tmp_path):
    with pytest.raises(LookupError):
        SqlStore(f"sqlite:///{tmp_path}/s.db").end_run("missing", "completed")


class FakeResponse:
    def __init__(self, status_code=201, body=None):
        self.status_code = status_code
        self._body = body or {"runId": "run_1"}

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self):
        return self._body


class FakeSession:
    def __init__(self, response=None):
        self.calls = []
        self.response = response or FakeResponse()

    def post(self, url, json, headers, timeout):
        self.calls.append({"url": url, "json": json, "headers": headers})
        return self.response


def test_rest_store_keyless_sends_project_and_no_auth_header():
    session = FakeSession()
    store = RestStore("http://h/api/events", session=session)
    assert store.create_run("support-bot", "r") == "run_1"
    store.log_event("run_1", {"source": "A", "target": "B", "type": "tool_call"})
    store.end_run("run_1", "failed")
    assert session.calls[0]["json"] == {"runId": None, "name": "r", "project": "support-bot"}
    assert "Authorization" not in session.calls[0]["headers"]
    assert session.calls[1]["json"] == {"runId": "run_1", "source": "A", "target": "B", "type": "tool_call"}
    assert session.calls[2]["json"] == {"runId": "run_1", "endRun": "failed"}


def test_rest_store_with_key_and_no_project():
    session = FakeSession()
    RestStore("http://h/api/events", api_key="atr_x", session=session).create_run(None, "r")
    assert session.calls[0]["json"] == {"runId": None, "name": "r"}
    assert session.calls[0]["headers"]["Authorization"] == "Bearer atr_x"


def test_rest_store_401_without_key_mentions_agenttrace_key():
    """Review focus #5."""
    store = RestStore("http://h/api/events", session=FakeSession(FakeResponse(401, {"error": "x"})))
    with pytest.raises(PermissionError, match="AGENTTRACE_KEY"):
        store.create_run("p", "r")


def test_store_for_uri(monkeypatch, tmp_path):
    monkeypatch.setenv("AGENTTRACE_KEY", "atr_env")
    rest = store_for_uri("http://h:3000")
    assert isinstance(rest, RestStore)
    assert rest.events_url == "http://h:3000/api/events" and rest.api_key == "atr_env"
    assert isinstance(store_for_uri(f"sqlite:///{tmp_path}/x.db"), SqlStore)
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/pytest python-server/tests/tracking/test_stores.py -q` → FAIL (`ModuleNotFoundError ... stores`).

- [ ] **Step 3: Implement**

`stores/base.py`:
```python
"""The storage contract behind every run, MLflow-style: the tracking URI
picks the implementation, callers only see these three operations. `event`
dicts use the `/api/events` wire field names."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Optional


class TrackingStore(ABC):
    @abstractmethod
    def create_run(self, project: Optional[str], name: str) -> str: ...

    @abstractmethod
    def log_event(self, run_id: str, event: dict) -> None: ...

    @abstractmethod
    def end_run(self, run_id: str, status: str) -> None: ...
```

`stores/sql.py`:
```python
"""Writes straight to the AgentTrace database — the zero-config default
(`./agenttrace.db`), so tracing works without any server running."""

from __future__ import annotations

from typing import Optional

from ...store import db as store_db
from ...store import events, local, models
from .base import TrackingStore

DEFAULT_PROJECT = "Default"


class SqlStore(TrackingStore):
    def __init__(self, url: str):
        self.url = url
        self._initialized = False

    def _session(self):
        if not self._initialized:
            store_db.init_db(self.url)
            self._initialized = True
        return store_db.get_sessionmaker(self.url)()

    def create_run(self, project: Optional[str], name: str) -> str:
        with self._session() as db:
            user = local.get_or_create_local_user(db)
            proj = local.get_or_create_project(db, user, project or DEFAULT_PROJECT)
            return events.create_run(db, proj.id, name).id

    def log_event(self, run_id: str, event: dict) -> None:
        with self._session() as db:
            events.append_event(db, run_id, event)

    def end_run(self, run_id: str, status: str) -> None:
        with self._session() as db:
            run = db.get(models.Run, run_id)
            if run is None:
                raise LookupError(f"AgentTrace run {run_id!r} not found in {self.url}")
            events.close_run(db, run, status)
```

`stores/rest.py`:
```python
"""Posts to a running AgentTrace server (`POST /api/events`). Without an
API key it relies on the server's `--auth none` local mode and names the
project explicitly; with a key the key determines the project."""

from __future__ import annotations

from typing import Any, Optional

import requests

from .base import TrackingStore


class RestStore(TrackingStore):
    def __init__(self, events_url: str, api_key: Optional[str] = None, timeout: float = 10.0, session: Any = None):
        self.events_url = events_url
        self.api_key = api_key
        self.timeout = timeout
        self._session = session

    def _post(self, body: dict) -> dict:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        post = self._session.post if self._session is not None else requests.post
        response = post(self.events_url, json=body, headers=headers, timeout=self.timeout)
        if response.status_code == 401 and not self.api_key:
            raise PermissionError(
                f"{self.events_url} requires an API key — set AGENTTRACE_KEY "
                "(or start the server with `agenttrace ui --auth none`)."
            )
        response.raise_for_status()
        return response.json()

    def create_run(self, project: Optional[str], name: str) -> str:
        body: dict[str, Any] = {"runId": None, "name": name}
        if project is not None:
            body["project"] = project
        return self._post(body)["runId"]

    def log_event(self, run_id: str, event: dict) -> None:
        self._post({"runId": run_id, **event})

    def end_run(self, run_id: str, status: str) -> None:
        self._post({"runId": run_id, "endRun": status})
```

`stores/__init__.py`:
```python
"""Tracking stores and the URI -> store factory."""

from __future__ import annotations

import os

from .._uri import events_url, is_http_uri
from .base import TrackingStore
from .rest import RestStore
from .sql import SqlStore

__all__ = ["RestStore", "SqlStore", "TrackingStore", "store_for_uri"]


def store_for_uri(uri: str) -> TrackingStore:
    if is_http_uri(uri):
        return RestStore(events_url(uri), api_key=os.getenv("AGENTTRACE_KEY"))
    return SqlStore(uri)
```

- [ ] **Step 4: Run to verify pass**

Run: `.venv/bin/pytest python-server/tests/tracking/test_stores.py -q` → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A python-server
git commit -m "feat: SqlStore and RestStore tracking stores"
```

---

### Task 5: ActiveRun — non-blocking, never-fatal, atexit-safe

**Files:**
- Create: `python-server/agenttrace/tracking/run.py`
- Test: `python-server/tests/tracking/test_run.py`

**Interfaces:**
- Consumes: Task 2 `VALID_EVENT_TYPES`; Task 4 `TrackingStore`.
- Produces (`agenttrace.tracking.run`):
  - constants `LABEL_LIMIT=80, PAYLOAD_LIMIT=2000, RESULT_LIMIT=500, ANSWER_LIMIT=500`; `truncate(text: str, limit: int) -> str`; `compact(value, limit=PAYLOAD_LIMIT)`
  - `class ActiveRun(store: TrackingStore, name: str, *, project: str | None = None, on_end: Callable[[ActiveRun], None] | None = None, disabled_reason: str | None = None)`
    - `log_event(*, source, target, type, label=None, payload=None, duration_ms=None, status=None) -> None` (raises `ValueError` on bad type); `emit` is an alias
    - `end(status: str = "completed") -> None` (idempotent, calls `on_end(self)` once)
    - `close(timeout: float = 10.0) -> None` (idempotent)
    - `run_id -> str | None` property (forces creation, waits ≤10 s)
    - `name: str`, `project: str | None`, `_failed: bool` (read by tests/legacy)
    - context manager: `__exit__` ends `failed` on exception else `completed`, then closes; never suppresses
  - module function `_close_all_open_runs() -> None` registered with `atexit`

- [ ] **Step 1: Write the failing tests**

`python-server/tests/tracking/test_run.py`:
```python
import subprocess
import sys
import textwrap
import time

import pytest

from agenttrace.store import db as store_db
from agenttrace.store import models
from agenttrace.tracking.run import ActiveRun, compact, truncate
from agenttrace.tracking.stores.base import TrackingStore


class RecordingStore(TrackingStore):
    def __init__(self, fail_on=None):
        self.calls = []
        self.fail_on = fail_on

    def _record(self, *call):
        if self.fail_on == call[0]:
            raise ConnectionError("boom")
        self.calls.append(call)

    def create_run(self, project, name):
        self._record("create_run", project, name)
        return "run_1"

    def log_event(self, run_id, event):
        self._record("log_event", run_id, event)

    def end_run(self, run_id, status):
        self._record("end_run", run_id, status)


def _wait_until(predicate, timeout=2.0):
    deadline = time.time() + timeout
    while time.time() < deadline and not predicate():
        time.sleep(0.01)
    return predicate()


def test_truncate_and_compact():
    assert truncate("hello", 10) == "hello"
    assert truncate("x" * 20, 5) == "xxxxx…"
    assert compact({"a": 1}) == {"a": 1}
    assert isinstance(compact({"d": "x" * 5000}, limit=100), str)


def test_events_are_written_in_order_and_run_created_lazily():
    store = RecordingStore()
    run = ActiveRun(store, "r", project="p")
    time.sleep(0.05)
    assert store.calls == []  # nothing until the first item
    run.log_event(source="O", target="LLM", type="llm_call", duration_ms=5)
    run.log_event(source="O", target="User", type="final_answer")
    run.end()
    run.close(timeout=2)
    assert store.calls == [
        ("create_run", "p", "r"),
        ("log_event", "run_1", {"source": "O", "target": "LLM", "type": "llm_call", "durationMs": 5}),
        ("log_event", "run_1", {"source": "O", "target": "User", "type": "final_answer"}),
        ("end_run", "run_1", "completed"),
    ]


def test_invalid_type_raises_synchronously():
    run = ActiveRun(RecordingStore(), "r")
    with pytest.raises(ValueError, match="type must be one of"):
        run.log_event(source="a", target="b", type="nope")
    run.close(timeout=2)


def test_store_failure_disables_run_without_raising(caplog):
    store = RecordingStore(fail_on="log_event")
    run = ActiveRun(store, "r")
    run.log_event(source="a", target="b", type="tool_call")
    assert _wait_until(lambda: run._failed)
    run.log_event(source="a", target="b", type="tool_call")  # silently dropped
    run.end()
    run.close(timeout=2)
    assert store.calls == [("create_run", None, "r")]
    assert "AgentTrace disabled" in caplog.text


def test_context_manager_marks_failed_and_reraises():
    store = RecordingStore()
    with pytest.raises(KeyError):
        with ActiveRun(store, "r") as run:
            run.log_event(source="a", target="b", type="tool_call")
            raise KeyError("x")
    assert store.calls[-1] == ("end_run", "run_1", "failed")


def test_run_id_forces_creation_and_end_is_idempotent():
    ended = []
    store = RecordingStore()
    run = ActiveRun(store, "r", on_end=ended.append)
    assert run.run_id == "run_1"
    run.end("completed")
    run.end("failed")
    run.close(timeout=2)
    assert [c for c in store.calls if c[0] == "end_run"] == [("end_run", "run_1", "completed")]
    assert ended == [run]


def test_disabled_reason_never_touches_store(caplog):
    store = RecordingStore()
    run = ActiveRun(store, "r", disabled_reason="no key")
    run.log_event(source="a", target="b", type="tool_call")
    run.close(timeout=2)
    assert store.calls == [] and run.run_id is None and "no key" in caplog.text


def test_short_script_flushes_on_interpreter_exit(tmp_path):
    """Review focus #1: no explicit end/close, the process just exits."""
    url = f"sqlite:///{tmp_path}/exit.db"
    script = textwrap.dedent(f"""
        from agenttrace.tracking.run import ActiveRun
        from agenttrace.tracking.stores.sql import SqlStore
        run = ActiveRun(SqlStore({url!r}), "exit run")
        for i in range(20):
            run.log_event(source="O", target="T", type="tool_call", label=str(i))
    """)
    subprocess.run([sys.executable, "-c", script], check=True, timeout=60)
    with store_db.get_sessionmaker(url)() as db:
        run = db.query(models.Run).one()
        assert run.status == "completed"
        assert len(run.events) == 20
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/pytest python-server/tests/tracking/test_run.py -q` → FAIL (`ModuleNotFoundError ... run`).

- [ ] **Step 3: Implement**

`python-server/agenttrace/tracking/run.py`:
```python
"""ActiveRun — one AgentTrace run on top of any TrackingStore, with the
contract the LangChain middleware has always had:

- **non-blocking**: `log_event()`/`end()` push onto a queue drained by one
  background thread per run (FIFO, which preserves `seq` ordering);
- **never fatal**: the first store error disables the run (one warning), the
  caller's agent keeps running — only an invalid event type raises, because
  that is a programming error;
- **lazy**: the run is created on the first queued item (or on `run_id`);
- **exit-safe**: an atexit hook ends (`completed`) and drains every run still
  open, so short scripts don't lose their last events.
"""

from __future__ import annotations

import atexit
import json
import logging
import queue
import threading
from typing import Any, Callable, Optional

from ..store.events import VALID_EVENT_TYPES
from .stores.base import TrackingStore

logger = logging.getLogger(__name__)

LABEL_LIMIT = 80
PAYLOAD_LIMIT = 2000
RESULT_LIMIT = 500
ANSWER_LIMIT = 500

_CREATE = object()  # queue marker: create the run now (used by `run_id`)
_STOP = None

_open_runs: set["ActiveRun"] = set()
_open_runs_lock = threading.Lock()


def truncate(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[:limit] + "…"


def compact(value: Any, limit: int = PAYLOAD_LIMIT) -> Any:
    """Return `value` as-is if its JSON form is compact, else a truncated preview."""
    try:
        text = json.dumps(value, ensure_ascii=False, default=str)
    except (TypeError, ValueError):
        return truncate(repr(value), limit)
    if len(text) <= limit:
        return value
    return truncate(text, limit)


class ActiveRun:
    def __init__(
        self,
        store: TrackingStore,
        name: str,
        *,
        project: Optional[str] = None,
        on_end: Optional[Callable[["ActiveRun"], None]] = None,
        disabled_reason: Optional[str] = None,
    ):
        self.name = truncate(name, 120)
        self.project = project
        self._store = store
        self._on_end = on_end
        self._queue: "queue.Queue[Any]" = queue.Queue()
        self._run_id: Optional[str] = None
        self._created = threading.Event()
        self._failed = disabled_reason is not None
        self._ended = False
        self._closed = False
        if disabled_reason:
            logger.warning("AgentTrace tracing disabled for run %r — %s", self.name, disabled_reason)
            self._created.set()
        self._thread = threading.Thread(target=self._drain, name=f"agenttrace-run-{self.name}", daemon=True)
        self._thread.start()
        with _open_runs_lock:
            _open_runs.add(self)

    # ----- public API (never blocks, never raises except ValueError) -----
    def log_event(
        self,
        *,
        source: str,
        target: str,
        type: str,
        label: Optional[str] = None,
        payload: Optional[dict] = None,
        duration_ms: Optional[int] = None,
        status: Optional[str] = None,
    ) -> None:
        if type not in VALID_EVENT_TYPES:
            raise ValueError(f"type must be one of: {', '.join(sorted(VALID_EVENT_TYPES))}")
        if self._failed or self._ended:
            return
        event: dict[str, Any] = {"source": source, "target": target, "type": type}
        if label is not None:
            event["label"] = label
        if payload is not None:
            event["payload"] = payload
        if duration_ms is not None:
            event["durationMs"] = duration_ms
        if status is not None:
            event["status"] = status
        self._queue.put_nowait(event)

    emit = log_event  # pre-0.2 AgentTraceRun name, used by the middleware

    def end(self, status: str = "completed") -> None:
        if self._ended:
            return
        self._ended = True
        if not self._failed:
            self._queue.put_nowait({"endRun": status})
        if self._on_end is not None:
            self._on_end(self)

    def close(self, timeout: float = 10.0) -> None:
        if self._closed:
            return
        self._closed = True
        self._queue.put_nowait(_STOP)
        self._thread.join(timeout)
        with _open_runs_lock:
            _open_runs.discard(self)

    @property
    def run_id(self) -> Optional[str]:
        if not self._created.is_set():
            if self._closed:
                return None  # the worker is gone, nothing will create it now
            self._queue.put_nowait(_CREATE)
        self._created.wait(10.0)
        return self._run_id

    def __enter__(self) -> "ActiveRun":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        self.end("failed" if exc_type is not None else "completed")
        self.close()
        return False

    # ----- background worker -----
    def _ensure_created(self) -> None:
        if self._created.is_set():
            return
        try:
            self._run_id = self._store.create_run(self.project, self.name)
        except Exception as exc:  # noqa: BLE001 - must never crash the caller
            self._disable(exc)
        finally:
            self._created.set()

    def _drain(self) -> None:
        while True:
            item = self._queue.get()
            if item is _STOP:
                return
            if self._failed:
                continue  # drain without writing once disabled
            self._ensure_created()
            if self._failed or item is _CREATE:
                continue
            try:
                if "endRun" in item:
                    self._store.end_run(self._run_id, item["endRun"])
                else:
                    self._store.log_event(self._run_id, item)
            except Exception as exc:  # noqa: BLE001 - must never crash the caller
                self._disable(exc)

    def _disable(self, exc: Exception) -> None:
        self._failed = True
        logger.warning("AgentTrace disabled for run %r (%s): %s", self.name, type(self._store).__name__, exc)


def _close_all_open_runs() -> None:
    with _open_runs_lock:
        runs = list(_open_runs)
    for run in runs:
        run.end("completed")
        run.close(timeout=5.0)


atexit.register(_close_all_open_runs)
```

- [ ] **Step 4: Run to verify pass**

Run: `.venv/bin/pytest python-server/tests/tracking/test_run.py -q` → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A python-server
git commit -m "feat: ActiveRun with non-blocking store writes and atexit flush"
```

---

### Task 6: Fluent API, `@trace`, explicit `AgentTraceClient`

**Files:**
- Create: `python-server/agenttrace/tracking/fluent.py`, `python-server/agenttrace/tracking/client.py`
- Modify: `python-server/agenttrace/__init__.py`, `python-server/tests/conftest.py`
- Test: `python-server/tests/tracking/test_fluent.py`, `python-server/tests/tracking/test_client.py`

**Interfaces:**
- Consumes: Task 3 `set_tracking_uri/get_tracking_uri`; Task 4 `store_for_uri`; Task 5 `ActiveRun`, `compact`, `truncate`, `LABEL_LIMIT`, `RESULT_LIMIT`.
- Produces (`agenttrace.tracking.fluent`, all re-exported from `agenttrace`):
  - `set_project(name: str | None) -> None`, `get_project() -> str` (explicit > `AGENTTRACE_PROJECT` > `"Default"`)
  - `start_run(name: str | None = None, *, project: str | None = None) -> ActiveRun`
  - `active_run() -> ActiveRun | None` (top of this context's stack, else the implicit run)
  - `end_run(status: str = "completed") -> None`
  - `log_event(*, source, target, type, label=None, payload=None, duration_ms=None, status=None) -> None`
  - `trace(fn=None, *, target: str | None = None, source: str = "Orchestrator")`
  - `_current_or_implicit_run() -> ActiveRun` (used by Task 10)
- Produces `agenttrace.tracking.client.AgentTraceClient(tracking_uri: str | None = None)` with `create_run(name: str, project: str = "Default") -> str`, `log_event(run_id, *, source, target, type, label=None, payload=None, duration_ms=None, status=None) -> None`, `end_run(run_id, status="completed") -> None`, attribute `tracking_uri: str`.
- Produces conftest fixtures: `tracking_db` (sets the tracking URI to a fresh tmp SQLite file, resets project/implicit run, yields the URL) and helper `read_runs(url) -> list[dict]` (each `{"name", "status", "project", "events": [{"type","source","target","label","status","payload"}]}`, ordered by `started_at`).

- [ ] **Step 1: Add shared test fixtures**

Append to `python-server/tests/conftest.py` (keep the existing env setup at the very top, before these imports):
```python
import json

import pytest


def read_runs(url):
    from agenttrace.store import db as store_db
    from agenttrace.store import models

    with store_db.get_sessionmaker(url)() as db:
        runs = db.query(models.Run).order_by(models.Run.started_at).all()
        return [
            {
                "name": r.name,
                "status": r.status,
                "project": r.project.name,
                "events": [
                    {
                        "type": e.type,
                        "source": e.source,
                        "target": e.target,
                        "label": e.label,
                        "status": e.status,
                        "payload": json.loads(e.payload),
                    }
                    for e in r.events
                ],
            }
            for r in runs
        ]


@pytest.fixture
def tracking_db(tmp_path, monkeypatch):
    import agenttrace
    from agenttrace.tracking import fluent

    for var in ("AGENTTRACE_TRACKING_URI", "AGENTTRACE_URL", "AGENTTRACE_PROJECT", "AGENTTRACE_KEY"):
        monkeypatch.delenv(var, raising=False)
    url = f"sqlite:///{tmp_path}/tracking.db"
    agenttrace.set_tracking_uri(url)
    agenttrace.set_project(None)
    yield url
    fluent._reset_for_tests()
    agenttrace.set_tracking_uri(None)
```

- [ ] **Step 2: Write the failing tests**

`python-server/tests/tracking/test_fluent.py`:
```python
import asyncio
import threading

import pytest

import agenttrace
from tests.conftest import read_runs


def test_start_run_context_manager_writes_to_tracking_db(tracking_db):
    agenttrace.set_project("support-bot")
    with agenttrace.start_run("first") as run:
        assert agenttrace.active_run() is run
        agenttrace.log_event(source="Orchestrator", target="LLM", type="llm_call")
    assert agenttrace.active_run() is None
    [stored] = read_runs(tracking_db)
    assert stored["name"] == "first" and stored["project"] == "support-bot"
    assert stored["status"] == "completed"
    assert [e["type"] for e in stored["events"]] == ["llm_call"]


def test_exception_marks_run_failed(tracking_db):
    with pytest.raises(RuntimeError):
        with agenttrace.start_run("boom"):
            raise RuntimeError("x")
    assert read_runs(tracking_db)[0]["status"] == "failed"


def test_nested_runs_are_separate_and_stack(tracking_db):
    with agenttrace.start_run("outer") as outer:
        with agenttrace.start_run("inner") as inner:
            assert agenttrace.active_run() is inner
            agenttrace.log_event(source="a", target="b", type="tool_call")
        assert agenttrace.active_run() is outer
    runs = {r["name"]: r for r in read_runs(tracking_db)}
    assert len(runs["inner"]["events"]) == 1 and runs["outer"]["events"] == []


def test_log_event_without_run_starts_implicit_run(tracking_db):
    agenttrace.log_event(source="a", target="b", type="tool_call")
    implicit = agenttrace.active_run()
    assert implicit is not None and implicit.name.startswith("run ")
    agenttrace.end_run()
    assert agenttrace.active_run() is None
    [stored] = read_runs(tracking_db)
    assert stored["status"] == "completed" and stored["project"] == "Default"


def test_project_env_var(tracking_db, monkeypatch):
    monkeypatch.setenv("AGENTTRACE_PROJECT", "from-env")
    assert agenttrace.get_project() == "from-env"
    agenttrace.set_project("explicit")
    assert agenttrace.get_project() == "explicit"


def test_runs_are_isolated_per_thread(tracking_db):
    seen = {}
    with agenttrace.start_run("main"):
        t = threading.Thread(target=lambda: seen.setdefault("other", agenttrace.active_run()))
        t.start()
        t.join()
    assert seen["other"] is None


async def test_runs_are_isolated_per_asyncio_task(tracking_db):
    async def worker(name):
        with agenttrace.start_run(name) as run:
            await asyncio.sleep(0.01)
            assert agenttrace.active_run() is run

    await asyncio.gather(worker("a"), worker("b"))
    assert sorted(r["name"] for r in read_runs(tracking_db)) == ["a", "b"]


def test_trace_decorator_sync_success_and_error(tracking_db):
    @agenttrace.trace
    def add(a, b):
        return a + b

    @agenttrace.trace(target="flaky")
    def explode():
        raise ValueError("nope")

    with agenttrace.start_run("traced"):
        assert add(1, b=2) == 3
        with pytest.raises(ValueError):
            explode()

    events = read_runs(tracking_db)[0]["events"]
    assert [(e["type"], e["source"], e["target"]) for e in events] == [
        ("tool_call", "Orchestrator", "add"),
        ("tool_result", "add", "Orchestrator"),
        ("tool_call", "Orchestrator", "flaky"),
        ("error", "flaky", "Orchestrator"),
    ]
    assert events[0]["payload"] == {"args": [1], "kwargs": {"b": 2}}
    assert events[1]["payload"] == {"result": 3}
    assert events[3]["payload"] == {"error": "ValueError", "message": "nope"}
    assert events[3]["status"] == "error"


async def test_trace_decorator_async(tracking_db):
    @agenttrace.trace
    async def fetch(url):
        await asyncio.sleep(0)
        return "ok"

    with agenttrace.start_run("async"):
        assert await fetch("x") == "ok"
    assert [e["type"] for e in read_runs(tracking_db)[0]["events"]] == ["tool_call", "tool_result"]
```

`python-server/tests/tracking/test_client.py`:
```python
import pytest

from agenttrace import AgentTraceClient
from tests.conftest import read_runs


def test_explicit_client_is_synchronous_and_fail_loud(tmp_path):
    url = f"sqlite:///{tmp_path}/client.db"
    client = AgentTraceClient(url)
    run_id = client.create_run("explicit", project="p")
    client.log_event(run_id, source="a", target="b", type="tool_call", duration_ms=4)
    client.end_run(run_id, "failed")
    [stored] = read_runs(url)
    assert stored["status"] == "failed" and stored["project"] == "p" and len(stored["events"]) == 1

    with pytest.raises(ValueError):
        client.log_event(run_id, source="a", target="b", type="bad")
    with pytest.raises(LookupError):
        client.end_run("missing")
```

- [ ] **Step 3: Run to verify failure**

Run: `.venv/bin/pytest python-server/tests/tracking/test_fluent.py python-server/tests/tracking/test_client.py -q`
Expected: FAIL — `AttributeError: module 'agenttrace' has no attribute 'set_tracking_uri'`.

- [ ] **Step 4: Implement**

`python-server/agenttrace/tracking/fluent.py`:
```python
"""Module-level tracking API, MLflow-style (`agenttrace.start_run()` etc.).

The active-run stack lives in a ContextVar holding an immutable tuple, so
each thread and asyncio task sees its own current run. `log_event()`/`@trace`
with no active run start one implicit run per process (like MLflow), ended
by `end_run()` or at interpreter exit.
"""

from __future__ import annotations

import functools
import inspect
import os
import threading
import time
from contextvars import ContextVar
from datetime import datetime
from typing import Any, Callable, Optional

from ._uri import get_tracking_uri
from .run import LABEL_LIMIT, RESULT_LIMIT, ActiveRun, compact, truncate
from .stores import store_for_uri

DEFAULT_PROJECT = "Default"

_project: Optional[str] = None
_active_runs: ContextVar[tuple[ActiveRun, ...]] = ContextVar("agenttrace_active_runs", default=())
_implicit_run: Optional[ActiveRun] = None
_implicit_lock = threading.Lock()


def set_project(name: Optional[str]) -> None:
    global _project
    _project = name or None


def get_project() -> str:
    return _project or os.getenv("AGENTTRACE_PROJECT") or DEFAULT_PROJECT


def _default_run_name() -> str:
    return f"run {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"


def _forget(run: ActiveRun) -> None:
    global _implicit_run
    _active_runs.set(tuple(r for r in _active_runs.get() if r is not run))
    with _implicit_lock:
        if _implicit_run is run:
            _implicit_run = None


def _new_run(name: Optional[str], project: Optional[str]) -> ActiveRun:
    return ActiveRun(
        store_for_uri(get_tracking_uri()),
        name or _default_run_name(),
        project=project or get_project(),
        on_end=_forget,
    )


def start_run(name: Optional[str] = None, *, project: Optional[str] = None) -> ActiveRun:
    run = _new_run(name, project)
    _active_runs.set(_active_runs.get() + (run,))
    return run


def active_run() -> Optional[ActiveRun]:
    stack = _active_runs.get()
    if stack:
        return stack[-1]
    return _implicit_run


def _current_or_implicit_run() -> ActiveRun:
    global _implicit_run
    run = active_run()
    if run is not None:
        return run
    with _implicit_lock:
        if _implicit_run is None:
            _implicit_run = _new_run(None, None)
        return _implicit_run


def end_run(status: str = "completed") -> None:
    run = active_run()
    if run is not None:
        run.end(status)
        run.close()


def log_event(
    *,
    source: str,
    target: str,
    type: str,
    label: Optional[str] = None,
    payload: Optional[dict] = None,
    duration_ms: Optional[int] = None,
    status: Optional[str] = None,
) -> None:
    _current_or_implicit_run().log_event(
        source=source, target=target, type=type, label=label, payload=payload, duration_ms=duration_ms, status=status
    )


def trace(fn: Optional[Callable] = None, *, target: Optional[str] = None, source: str = "Orchestrator"):
    """Decorator emitting tool_call -> tool_result | error around a function (sync or async)."""

    def decorate(func: Callable) -> Callable:
        name = target or func.__name__

        def before(args: tuple, kwargs: dict) -> tuple[ActiveRun, float]:
            run = _current_or_implicit_run()
            arg_text = ", ".join([repr(a) for a in args] + [f"{k}={v!r}" for k, v in kwargs.items()])
            run.log_event(
                source=source,
                target=name,
                type="tool_call",
                label=f"{name}({truncate(arg_text, LABEL_LIMIT)})",
                payload={"args": compact(list(args)), "kwargs": compact(kwargs)},
            )
            return run, time.monotonic()

        def after(run: ActiveRun, result: Any, started: float) -> None:
            run.log_event(
                source=name,
                target=source,
                type="tool_result",
                label=f"{name} → result",
                payload={"result": compact(result, RESULT_LIMIT)},
                duration_ms=int((time.monotonic() - started) * 1000),
            )

        def failed(run: ActiveRun, exc: BaseException) -> None:
            run.log_event(
                source=name,
                target=source,
                type="error",
                label=f"{name} failed",
                payload={"error": type(exc).__name__, "message": str(exc)},
                status="error",
            )

        if inspect.iscoroutinefunction(func):

            @functools.wraps(func)
            async def async_wrapper(*args, **kwargs):
                run, started = before(args, kwargs)
                try:
                    result = await func(*args, **kwargs)
                except Exception as exc:
                    failed(run, exc)
                    raise
                after(run, result, started)
                return result

            return async_wrapper

        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            run, started = before(args, kwargs)
            try:
                result = func(*args, **kwargs)
            except Exception as exc:
                failed(run, exc)
                raise
            after(run, result, started)
            return result

        return wrapper

    return decorate(fn) if fn is not None else decorate


def _reset_for_tests() -> None:
    """End every run this module knows about and clear global state."""
    global _project
    for run in list(_active_runs.get()):
        run.end()
        run.close()
    _active_runs.set(())
    end_run()
    _project = None
```

`python-server/agenttrace/tracking/client.py`:
```python
"""AgentTraceClient — explicit, synchronous, fail-loud access to a tracking
store (the `MlflowClient` of AgentTrace). Use the fluent API or ActiveRun
when tracing must never break the traced program."""

from __future__ import annotations

from typing import Any, Optional

from ..store.events import VALID_EVENT_TYPES
from ._uri import get_tracking_uri
from .stores import store_for_uri

DEFAULT_PROJECT = "Default"


class AgentTraceClient:
    def __init__(self, tracking_uri: Optional[str] = None):
        self.tracking_uri = tracking_uri or get_tracking_uri()
        self._store = store_for_uri(self.tracking_uri)

    def create_run(self, name: str, project: str = DEFAULT_PROJECT) -> str:
        return self._store.create_run(project, name)

    def log_event(
        self,
        run_id: str,
        *,
        source: str,
        target: str,
        type: str,
        label: Optional[str] = None,
        payload: Optional[dict] = None,
        duration_ms: Optional[int] = None,
        status: Optional[str] = None,
    ) -> None:
        if type not in VALID_EVENT_TYPES:
            raise ValueError(f"type must be one of: {', '.join(sorted(VALID_EVENT_TYPES))}")
        event: dict[str, Any] = {"source": source, "target": target, "type": type}
        if label is not None:
            event["label"] = label
        if payload is not None:
            event["payload"] = payload
        if duration_ms is not None:
            event["durationMs"] = duration_ms
        if status is not None:
            event["status"] = status
        self._store.log_event(run_id, event)

    def end_run(self, run_id: str, status: str = "completed") -> None:
        self._store.end_run(run_id, status)
```

`python-server/agenttrace/__init__.py`:
```python
"""AgentTrace — live sequence-diagram tracing for AI agents, MLflow-style.

    import agenttrace
    agenttrace.set_project("support-bot")
    with agenttrace.start_run("triage"):
        agenttrace.log_event(source="Orchestrator", target="LLM", type="llm_call")

Runs go to ./agenttrace.db unless `set_tracking_uri()` /
AGENTTRACE_TRACKING_URI points elsewhere (another SQLAlchemy URL, or an
`agenttrace ui` server over http(s)).
"""

from .tracking._uri import get_tracking_uri, set_tracking_uri
from .tracking.client import AgentTraceClient
from .tracking.fluent import active_run, end_run, get_project, log_event, set_project, start_run, trace
from .tracking.run import ActiveRun

__version__ = "0.2.0"

__all__ = [
    "ActiveRun",
    "AgentTraceClient",
    "active_run",
    "end_run",
    "get_project",
    "get_tracking_uri",
    "log_event",
    "set_project",
    "set_tracking_uri",
    "start_run",
    "trace",
]
```

- [ ] **Step 5: Run to verify pass**

Run: `.venv/bin/pytest python-server/tests -q` → PASS (all).

- [ ] **Step 6: Commit**

```bash
git add -A python-server
git commit -m "feat: fluent tracking API, @trace decorator and explicit AgentTraceClient"
```

---

### Task 7: Keyless local mode on the server + `--auth`

**Files:**
- Modify: `python-server/agenttrace/server/deps.py`, `python-server/agenttrace/server/routes/events.py`, `python-server/agenttrace/cli.py`
- Test: `python-server/tests/test_server_local_mode.py`, append to `python-server/tests/test_cli.py`

**Interfaces:**
- Consumes: Task 2 `get_or_create_local_user`, `get_or_create_project`; Task 4 `RestStore(events_url, session=...)`.
- Produces: `agenttrace.server.deps.auth_mode() -> str` (`"none"` iff `AGENTTRACE_AUTH == "none"`, else `"password"`); `ingest_project(request, db) -> models.Project | None`; CLI `agenttrace ui --auth [none|password]`, `LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}`.

- [ ] **Step 1: Write the failing tests**

`python-server/tests/test_server_local_mode.py`:
```python
import pytest
from fastapi.testclient import TestClient

from agenttrace.server.app import app
from agenttrace.tracking.stores.rest import RestStore


@pytest.fixture
def local_client(monkeypatch):
    monkeypatch.setenv("AGENTTRACE_AUTH", "none")
    with TestClient(app) as c:
        yield c


def test_keyless_ingestion_creates_project_by_name(local_client):
    created = local_client.post("/api/events", json={"runId": None, "name": "r", "project": "support-bot"})
    assert created.status_code == 201
    run_id = created.json()["runId"]
    ev = local_client.post("/api/events", json={"runId": run_id, "source": "a", "target": "b", "type": "llm_call"})
    assert ev.status_code == 201
    again = local_client.post("/api/events", json={"runId": None, "name": "r2", "project": "support-bot"}).json()

    projects = local_client.get("/api/projects").json()["projects"]
    bot = [p for p in projects if p["name"] == "support-bot"]
    assert len(bot) == 1 and bot[0]["_count"]["runs"] >= 2
    assert local_client.get(f"/api/runs/{again['runId']}").status_code == 200


def test_keyless_create_requires_project(local_client):
    resp = local_client.post("/api/events", json={"runId": None, "name": "r"})
    assert resp.status_code == 400
    assert "project" in resp.json()["error"]


def test_dashboard_routes_work_without_login(local_client):
    assert local_client.get("/api/stats").status_code == 200


def test_api_key_still_takes_precedence(local_client, monkeypatch):
    resp = local_client.post(
        "/api/events", json={"runId": None, "name": "x"}, headers={"Authorization": "Bearer atr_deadbeef"}
    )
    assert resp.status_code == 401


def test_password_mode_unchanged(monkeypatch):
    monkeypatch.setenv("AGENTTRACE_AUTH", "password")
    with TestClient(app) as c:
        assert c.post("/api/events", json={"runId": None, "name": "x", "project": "p"}).status_code == 401
        assert c.get("/api/stats").status_code == 401


def test_rest_store_end_to_end_against_local_server(local_client):
    store = RestStore("http://testserver/api/events", session=local_client)
    run_id = store.create_run("e2e", "rest run")
    store.log_event(run_id, {"source": "Orchestrator", "target": "web_search", "type": "tool_call"})
    store.end_run(run_id, "completed")
    run = local_client.get(f"/api/runs/{run_id}").json()["run"]
    assert run["status"] == "completed" and [e["type"] for e in run["events"]] == ["tool_call"]
```

Append to `python-server/tests/test_cli.py`:
```python
import os

import pytest


@pytest.fixture
def fake_uvicorn(monkeypatch):
    import uvicorn

    calls = []
    monkeypatch.setattr(uvicorn, "run", lambda *a, **k: calls.append((a, k)))
    monkeypatch.delenv("AGENTTRACE_AUTH", raising=False)
    return calls


@pytest.mark.parametrize(
    "args, expected",
    [([], "none"), (["--host", "0.0.0.0"], "password"), (["--auth", "password"], "password")],
)
def test_ui_auth_defaults(fake_uvicorn, monkeypatch, args, expected):
    result = CliRunner().invoke(cli.main, ["ui", *args])
    assert result.exit_code == 0, result.output
    assert os.environ["AGENTTRACE_AUTH"] == expected
    assert len(fake_uvicorn) == 1


def test_ui_warns_on_public_host_without_auth(fake_uvicorn):
    result = CliRunner().invoke(cli.main, ["ui", "--host", "0.0.0.0", "--auth", "none"])
    assert result.exit_code == 0
    assert "WARNING" in result.output
```
The CLI sets `os.environ["AGENTTRACE_AUTH"]` directly; `monkeypatch.delenv` in the fixture restores the original state after each test.

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/pytest python-server/tests/test_server_local_mode.py python-server/tests/test_cli.py -q`
Expected: FAIL — keyless POST returns 401; `--auth` is an unknown option.

- [ ] **Step 3: Implement**

`python-server/agenttrace/server/deps.py` — add:
```python
import os

from ..store.local import get_or_create_local_user


def auth_mode() -> str:
    """`none` (local, no login, MLflow-style) or `password` (accounts + keys).
    Read per request so tests and the CLI can switch it via the environment."""
    return "none" if os.getenv("AGENTTRACE_AUTH") == "none" else "password"
```
At the top of `require_user`:
```python
    if auth_mode() == "none":
        return get_or_create_local_user(db)
```
Add:
```python
def ingest_project(request: Request, db: Session = Depends(get_db)) -> models.Project | None:
    """Project for `POST /api/events`: from the API key when one is sent,
    `None` (resolved later from the body's `project`) in keyless local mode."""
    if request.headers.get("authorization") or auth_mode() != "none":
        return authenticate_api_key(request, db)
    return None
```

`python-server/agenttrace/server/routes/events.py`:
- import `from ..deps import ingest_project` (replace `authenticate_api_key`) and `from ...store.local import get_or_create_local_user, get_or_create_project`;
- signature: `project: models.Project | None = Depends(ingest_project)`;
- run creation:
```python
    if not run_id:
        name = str(body.get("name") or "Untitled run")
        if project is None:
            project_name = body.get("project")
            if not project_name:
                raise HTTPException(
                    status_code=400, detail={"error": "project is required when no API key is sent"}
                )
            project = get_or_create_project(db, get_or_create_local_user(db), str(project_name))
        run = create_run(db, project.id, name)
        return JSONResponse(status_code=201, content={"runId": run.id, "event": None})

    run = db.get(models.Run, run_id)
    if not run or (project is not None and run.project_id != project.id):
        raise HTTPException(status_code=404, detail={"error": "Run not found in this project"})
```
- update the module docstring: body also accepts `project` (used only without an API key, in `--auth none` mode).

`python-server/agenttrace/cli.py` — `ui` command:
```python
LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}

@click.option(
    "--auth",
    type=click.Choice(["none", "password"]),
    default=None,
    help="none: no login/API key (default on localhost). password: accounts + project keys (default otherwise).",
)
def ui(host: str, port: int, database_url: str | None, auth: str | None) -> None:
    """Start the AgentTrace web UI + API (and the /ws live-stream)."""
    _require_server_extra()
    if database_url:
        os.environ["DATABASE_URL"] = database_url
    if auth is None:
        auth = "none" if host in LOOPBACK_HOSTS else "password"
    elif auth == "none" and host not in LOOPBACK_HOSTS:
        click.echo(f"[AgentTrace] WARNING: --auth none on {host} — anyone who can reach this port can read and write traces.")
    os.environ["AGENTTRACE_AUTH"] = auth

    import uvicorn

    click.echo(f"[AgentTrace] Starting at http://{host}:{port} (auth: {auth})")
    uvicorn.run("agenttrace.server.app:app", host=host, port=port, log_level="info")
```

- [ ] **Step 4: Run to verify pass**

Run: `.venv/bin/pytest python-server/tests -q` → PASS (incl. existing `test_api.py`, which runs with `AGENTTRACE_AUTH` unset → password).

- [ ] **Step 5: Commit**

```bash
git add -A python-server
git commit -m "feat: keyless local mode (agenttrace ui --auth none) with projects created by name"
```

---

### Task 8: DB poller as the single live-broadcast path

**Files:**
- Modify: `python-server/agenttrace/server/realtime.py`, `python-server/agenttrace/server/app.py`, `python-server/agenttrace/server/routes/events.py`
- Test: `python-server/tests/test_realtime_poller.py`

**Interfaces:**
- Consumes: `agenttrace.server.db.SessionLocal`, `agenttrace.server.serializers.event_out`, Task 4 `SqlStore`.
- Produces: `ConnectionManager.poll_once() -> list[tuple[str, dict]]` (sync), `ConnectionManager.poll_forever(interval: float = 0.5)` (async), `POLL_INTERVAL = 0.5`. Removes `broadcast_event`, `broadcast_run_update`, `_schedule`, `bind_loop`.

- [ ] **Step 1: Write the failing test**

`python-server/tests/test_realtime_poller.py`:
```python
import os

from fastapi.testclient import TestClient

from agenttrace.server.app import app
from agenttrace.tracking.stores.sql import SqlStore


def test_events_written_directly_to_db_are_streamed():
    store = SqlStore(os.environ["DATABASE_URL"])
    run_id = store.create_run("direct", "direct run")
    store.log_event(run_id, {"source": "Orchestrator", "target": "LLM", "type": "llm_call"})  # before subscribe

    with TestClient(app) as client, client.websocket_connect("/ws") as ws:
        ws.send_json({"action": "subscribe", "runId": run_id})
        assert ws.receive_json() == {"type": "subscribed", "runId": run_id}

        store.log_event(run_id, {"source": "Orchestrator", "target": "web_search", "type": "tool_call"})
        message = ws.receive_json()
        assert message["type"] == "event"
        assert message["data"]["target"] == "web_search"  # the pre-subscribe event is not re-sent
        assert message["data"]["seq"] == 1

        store.end_run(run_id, "completed")
        update = ws.receive_json()
        assert update["type"] == "run:update" and update["patch"]["status"] == "completed"


def test_poll_once_ignores_runs_without_subscribers():
    from agenttrace.server.realtime import ConnectionManager

    store = SqlStore(os.environ["DATABASE_URL"])
    run_id = store.create_run("direct", "nobody watching")
    store.log_event(run_id, {"source": "a", "target": "b", "type": "tool_call"})
    assert ConnectionManager().poll_once() == []
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/pytest python-server/tests/test_realtime_poller.py -q`
Expected: first test hangs on `receive_json` (no broadcast for direct writes) — run with `timeout 60 .venv/bin/pytest ...` and expect a timeout/FAIL; second test FAILS with `AttributeError: ... poll_once`.

- [ ] **Step 3: Implement**

`python-server/agenttrace/server/realtime.py`:
- docstring: replace the paragraph about `broadcast_event` with: "Live events come from a poller (every 0.5 s, only runs with subscribers, `seq > last seen`) instead of being pushed by the ingestion route: the SDK can write to the database directly (SqlStore), bypassing the server, and the poller is the one path that sees both."
- imports: add `import logging`, `from datetime import datetime`, `from typing import Optional`, `from . import models`, `from .db import SessionLocal`, `from .serializers import event_out`; `logger = logging.getLogger(__name__)`; `POLL_INTERVAL = 0.5`.
- `__init__`: replace `self._loop` with `self._last_seq: dict[str, int] = {}` and `self._run_state: dict[str, tuple[str, Optional[str]]] = {}`.
- delete `bind_loop`, `broadcast_event`, `broadcast_run_update`, `_schedule`.
- new/changed methods:
```python
    async def subscribe(self, websocket: WebSocket, run_id: str) -> None:
        if run_id not in self._last_seq:
            await asyncio.to_thread(self._init_cursor, run_id)
        self._rooms.setdefault(run_id, set()).add(websocket)
        await websocket.send_json({"type": "subscribed", "runId": run_id})

    def unsubscribe(self, websocket: WebSocket, run_id: str) -> None:
        self._rooms.get(run_id, set()).discard(websocket)
        self._forget_if_empty(run_id)

    def disconnect(self, websocket: WebSocket) -> None:
        for run_id, room in list(self._rooms.items()):
            room.discard(websocket)
            self._forget_if_empty(run_id)
        for key in [k for k in self._replay_tasks if k[0] == id(websocket)]:
            self._replay_tasks.pop(key).cancel()

    def _forget_if_empty(self, run_id: str) -> None:
        if not self._rooms.get(run_id):
            self._rooms.pop(run_id, None)
            self._last_seq.pop(run_id, None)
            self._run_state.pop(run_id, None)

    def _init_cursor(self, run_id: str) -> None:
        with SessionLocal() as db:
            last = (
                db.query(models.Event.seq)
                .filter(models.Event.run_id == run_id)
                .order_by(models.Event.seq.desc())
                .limit(1)
                .scalar()
            )
            run = db.get(models.Run, run_id)
        self._last_seq[run_id] = last if last is not None else -1
        if run is not None:
            self._run_state[run_id] = _run_state(run)

    def poll_once(self) -> list[tuple[str, dict[str, Any]]]:
        """New events / status changes for every watched run (sync, runs in a thread)."""
        watched = [run_id for run_id, room in self._rooms.items() if room]
        if not watched:
            return []
        messages: list[tuple[str, dict[str, Any]]] = []
        with SessionLocal() as db:
            for run_id in watched:
                last = self._last_seq.get(run_id, -1)
                new_events = (
                    db.query(models.Event)
                    .filter(models.Event.run_id == run_id, models.Event.seq > last)
                    .order_by(models.Event.seq)
                    .all()
                )
                for event in new_events:
                    messages.append((run_id, {"type": "event", "data": event_out(event)}))
                    last = event.seq
                self._last_seq[run_id] = last
                run = db.get(models.Run, run_id)
                if run is None:
                    continue
                state = _run_state(run)
                if self._run_state.get(run_id) not in (None, state):
                    messages.append(
                        (run_id, {"type": "run:update", "runId": run_id, "patch": {"status": state[0], "endedAt": state[1]}})
                    )
                self._run_state[run_id] = state
        return messages

    async def poll_forever(self, interval: float = POLL_INTERVAL) -> None:
        while True:
            try:
                for run_id, message in await asyncio.to_thread(self.poll_once):
                    await self._broadcast(run_id, message)
            except Exception:  # noqa: BLE001 - a DB hiccup must not kill live updates
                logger.exception("AgentTrace live poller failed; retrying")
            await asyncio.sleep(interval)
```
and a module-level helper:
```python
def _run_state(run: models.Run) -> tuple[str, Optional[str]]:
    return run.status, run.ended_at.isoformat() if run.ended_at else None
```
Note: a run that had no status snapshot (`self._run_state.get(run_id) is None`, e.g. subscribed before the run row existed) records the state without emitting — intentional.

`python-server/agenttrace/server/app.py` — lifespan:
```python
@asynccontextmanager
async def _lifespan(app: FastAPI):
    init_db()
    poller = asyncio.create_task(manager.poll_forever())
    try:
        yield
    finally:
        poller.cancel()
```

`python-server/agenttrace/server/routes/events.py` — delete both `manager.broadcast_*` calls and the `manager`/`event_out` imports that become unused (keep `event_out` — the response body still uses it).

- [ ] **Step 4: Run to verify pass**

Run: `timeout 300 .venv/bin/pytest python-server/tests -q`
Expected: PASS, including the pre-existing `test_websocket_receives_broadcast_event` (now delivered by the poller).

- [ ] **Step 5: Commit**

```bash
git add -A python-server
git commit -m "feat: stream live events from a DB poller so direct SQLite writes appear live"
```

---

### Task 9: Move the LangChain integration into `agenttrace` + shim

**Files:**
- Move: `integrations/agenttrace-langchain/agenttrace_langchain/client.py` → `python-server/agenttrace/tracking/http.py`; `async_client.py` → `tracking/async_http.py`; `async_run.py` → `tracking/async_run.py`; `middleware.py` → `python-server/agenttrace/langchain/middleware.py`
- Delete: `integrations/agenttrace-langchain/agenttrace_langchain/run.py`
- Create: `python-server/agenttrace/langchain/__init__.py`
- Move tests: `integrations/agenttrace-langchain/tests/test_client.py` → `python-server/tests/tracking/test_legacy_http.py`; `test_run.py` → append its legacy tests to `test_legacy_http.py`; `test_async_run.py` → `python-server/tests/tracking/test_async_run.py`; `test_middleware.py` → `python-server/tests/langchain/test_middleware.py`
- Modify: `integrations/agenttrace-langchain/agenttrace_langchain/__init__.py`, `integrations/agenttrace-langchain/pyproject.toml`
- Create: `integrations/agenttrace-langchain/tests/test_shim.py`

**Interfaces:**
- Consumes: Task 3 `get_tracking_uri`; Task 4 `RestStore`, `store_for_uri`; Task 5 `ActiveRun`, helpers; Task 6 `get_project`.
- Produces:
  - `agenttrace.tracking.http.HttpEventClient(url=None, api_key=None, timeout=10.0)` (the old `AgentTraceClient`, unchanged behaviour), `DEFAULT_URL`, `VALID_EVENT_TYPES` (re-export of the store's), and `AgentTraceRun(name, *, client: HttpEventClient)` — an `ActiveRun` over `RestStore(client.url, client.api_key, client.timeout)` with `project=None`, disabled (no network) when `client.api_key` is falsy.
  - `agenttrace.tracking.async_http.AsyncHttpEventClient` (old `AsyncAgentTraceClient`).
  - `agenttrace.tracking.async_run.AsyncAgentTraceRun` (unchanged API).
  - `agenttrace.langchain.middleware.AgentTraceMiddleware(run_name="deepagents run", orchestrator="Orchestrator", url=None, api_key=None, timeout=10.0, project=None)`; module constant `HANDOFF_MARKERS = ("handoff", "delegate")` and helpers `_model_name, _last_model_message, _result_content, _token_usage, _extract_handoff_target, _last_message_text` (reused by Task 10).
  - `agenttrace.langchain` exports `AgentTraceMiddleware` (Task 10 adds `autolog`, `AgentTraceCallbackHandler`).

- [ ] **Step 1: Move files and tests with git**

```bash
mkdir -p python-server/agenttrace/langchain
git mv integrations/agenttrace-langchain/agenttrace_langchain/client.py python-server/agenttrace/tracking/http.py
git mv integrations/agenttrace-langchain/agenttrace_langchain/async_client.py python-server/agenttrace/tracking/async_http.py
git mv integrations/agenttrace-langchain/agenttrace_langchain/async_run.py python-server/agenttrace/tracking/async_run.py
git mv integrations/agenttrace-langchain/agenttrace_langchain/middleware.py python-server/agenttrace/langchain/middleware.py
git rm integrations/agenttrace-langchain/agenttrace_langchain/run.py
git mv integrations/agenttrace-langchain/tests/test_client.py python-server/tests/tracking/test_legacy_http.py
git mv integrations/agenttrace-langchain/tests/test_async_run.py python-server/tests/tracking/test_async_run.py
git mv integrations/agenttrace-langchain/tests/test_middleware.py python-server/tests/langchain/test_middleware.py
```
Then append the body of `integrations/agenttrace-langchain/tests/test_run.py` from `def _wait_until` onward to `python-server/tests/tracking/test_legacy_http.py` (merge imports: `import time`, `from agenttrace.tracking.http import AgentTraceRun`, `from agenttrace.tracking.run import compact, truncate`) and `git rm integrations/agenttrace-langchain/tests/test_run.py`.

- [ ] **Step 2: Point the moved tests at the new modules (they now fail)**

```bash
sed -i 's/from agenttrace_langchain.client import VALID_EVENT_TYPES, AgentTraceClient/from agenttrace.tracking.http import VALID_EVENT_TYPES, HttpEventClient as AgentTraceClient/; s/from agenttrace_langchain.client import AgentTraceClient/from agenttrace.tracking.http import HttpEventClient as AgentTraceClient/' python-server/tests/tracking/test_legacy_http.py
sed -i 's/from agenttrace_langchain.async_client import AsyncAgentTraceClient/from agenttrace.tracking.async_http import AsyncHttpEventClient as AsyncAgentTraceClient/; s/from agenttrace_langchain.async_run import AsyncAgentTraceRun/from agenttrace.tracking.async_run import AsyncAgentTraceRun/' python-server/tests/tracking/test_async_run.py
sed -i 's/from agenttrace_langchain.middleware import AgentTraceMiddleware/from agenttrace.langchain.middleware import AgentTraceMiddleware/' python-server/tests/langchain/test_middleware.py
grep -rn "agenttrace_langchain" python-server/tests && echo "LEFTOVER IMPORTS" || echo ok
```
Add to `python-server/tests/langchain/test_middleware.py`:
```python
def test_middleware_without_url_or_key_uses_tracking_uri(tracking_db):
    from tests.conftest import read_runs

    mw = AgentTraceMiddleware(run_name="local run", project="mw-project")
    mw.before_agent({"messages": []}, runtime=None)
    mw.wrap_tool_call(FakeToolRequest("noop", {}), lambda req: FakeToolMessage("ok"))
    mw.after_agent({"messages": [FakeToolMessage("done")]}, runtime=None)
    [run] = read_runs(tracking_db)
    assert run["name"] == "local run" and run["project"] == "mw-project" and run["status"] == "completed"
    assert [e["type"] for e in run["events"]] == ["tool_call", "tool_result", "final_answer"]
```
Run: `.venv/bin/pytest python-server/tests/tracking/test_legacy_http.py python-server/tests/tracking/test_async_run.py python-server/tests/langchain -q`
Expected: FAIL — `ImportError: cannot import name 'HttpEventClient'` (and relative imports inside moved modules break).

- [ ] **Step 3: Adapt the moved modules**

`tracking/http.py`:
- rename class `AgentTraceClient` → `HttpEventClient`; docstring first line: "Low-level HTTP client for `POST /api/events` (pre-0.2 `AgentTraceClient`). Prefer the fluent API or `agenttrace.AgentTraceClient`."
- replace the local `VALID_EVENT_TYPES = {...}` with `from ..store.events import VALID_EVENT_TYPES` (frozenset compares equal to the old set in `test_valid_event_types_match_prisma_contract`).
- append:
```python
from .run import ActiveRun  # noqa: E402 - below the client it wraps
from .stores.rest import RestStore  # noqa: E402


class AgentTraceRun(ActiveRun):
    """Pre-0.2 API: one run posted through an `HttpEventClient`. Without an
    API key it stays disabled (no network), as it always did."""

    def __init__(self, name: str, *, client: HttpEventClient):
        super().__init__(
            RestStore(client.url, api_key=client.api_key, timeout=client.timeout),
            name,
            disabled_reason=None
            if client.api_key
            else "no API key configured (pass api_key=... or set AGENTTRACE_KEY)",
        )
        self._client = client
```

`tracking/async_http.py`: rename `AsyncAgentTraceClient` → `AsyncHttpEventClient`; change `from .client import DEFAULT_URL, VALID_EVENT_TYPES` to `from .http import DEFAULT_URL, VALID_EVENT_TYPES`.

`tracking/async_run.py`: `from .async_client import AsyncAgentTraceClient` → `from .async_http import AsyncHttpEventClient`; replace the annotation `client: AsyncAgentTraceClient` with `client: AsyncHttpEventClient`; `.run` import stays valid (Task 5 kept the same helper names).

`langchain/middleware.py`:
- imports:
```python
import os

from ..tracking._uri import get_tracking_uri
from ..tracking.fluent import get_project
from ..tracking.http import DEFAULT_URL
from ..tracking.run import ANSWER_LIMIT, LABEL_LIMIT, RESULT_LIMIT, ActiveRun, compact, truncate
from ..tracking.stores import TrackingStore, store_for_uri
from ..tracking.stores.rest import RestStore
```
- rename `_HANDOFF_MARKERS` → `HANDOFF_MARKERS` (and its use);
- replace every `AgentTraceRun` annotation with `ActiveRun`;
- `__init__`: add `project: Optional[str] = None`; store `self._url, self._api_key, self._timeout, self.project = url, api_key, timeout, project` (drop `_client_kwargs`);
- replace `_ensure_run`:
```python
    def _make_store(self) -> TrackingStore:
        # Explicit url/api_key keep the pre-0.2 behaviour (HTTP to a server);
        # otherwise follow the tracking URI like the rest of the SDK.
        if self._url or self._api_key:
            return RestStore(
                self._url or os.getenv("AGENTTRACE_URL", DEFAULT_URL),
                api_key=self._api_key or os.getenv("AGENTTRACE_KEY"),
                timeout=self._timeout,
            )
        return store_for_uri(get_tracking_uri())

    def _ensure_run(self) -> ActiveRun:
        if self._run is None:
            project = None if (self._url or self._api_key) else (self.project or get_project())
            self._run = ActiveRun(self._make_store(), self.run_name, project=project)
        return self._run
```
- update the module docstring: "Built on `ActiveRun` (agenttrace.tracking.run) … writes to the tracking URI (./agenttrace.db by default) unless `url`/`api_key` are given."

`python-server/agenttrace/langchain/__init__.py`:
```python
"""LangChain / deepagents integration: `autolog()` for zero-code tracing,
or `AgentTraceMiddleware` / `AgentTraceCallbackHandler` to attach explicitly.
Requires `pip install 'deepagents-trace[langchain]'`."""

from .middleware import AgentTraceMiddleware

__all__ = ["AgentTraceMiddleware"]
```

- [ ] **Step 4: Run moved tests to verify pass**

Run: `.venv/bin/pytest python-server/tests -q` → PASS.

Note: `test_disabled_without_api_key_never_calls_network` needs `AgentTraceRun` to make no request; `test_emits_events_in_order_via_background_worker` asserts `bodies[0] == {"runId": None, "name": "test run"}` — satisfied because `RestStore.create_run` omits `project` when it is `None`.

- [ ] **Step 5: Turn `agenttrace-langchain` into a shim**

`integrations/agenttrace-langchain/agenttrace_langchain/__init__.py`:
```python
"""Deprecated: AgentTrace's LangChain integration now ships inside
`deepagents-trace` as `agenttrace.langchain` (plus `agenttrace.tracking`).
This package only re-exports the old names."""

import warnings

from agenttrace.langchain.middleware import AgentTraceMiddleware
from agenttrace.tracking.async_http import AsyncHttpEventClient as AsyncAgentTraceClient
from agenttrace.tracking.async_run import AsyncAgentTraceRun
from agenttrace.tracking.http import AgentTraceRun
from agenttrace.tracking.http import HttpEventClient as AgentTraceClient

warnings.warn(
    "agenttrace_langchain is deprecated: use `import agenttrace.langchain` "
    "(pip install 'deepagents-trace[langchain]').",
    DeprecationWarning,
    stacklevel=2,
)

__all__ = [
    "AgentTraceClient",
    "AgentTraceMiddleware",
    "AgentTraceRun",
    "AsyncAgentTraceClient",
    "AsyncAgentTraceRun",
]
```

`integrations/agenttrace-langchain/pyproject.toml`: version `0.2.0`, description `"Deprecated shim — use deepagents-trace[langchain] (import agenttrace.langchain)"`, `dependencies = ["deepagents-trace[langchain]>=0.2.0"]`.

`integrations/agenttrace-langchain/tests/test_shim.py`:
```python
import importlib
import sys

import pytest


def test_shim_reexports_and_warns():
    sys.modules.pop("agenttrace_langchain", None)
    with pytest.warns(DeprecationWarning, match="agenttrace.langchain"):
        shim = importlib.import_module("agenttrace_langchain")
    from agenttrace.langchain.middleware import AgentTraceMiddleware
    from agenttrace.tracking.http import HttpEventClient

    assert shim.AgentTraceMiddleware is AgentTraceMiddleware
    assert shim.AgentTraceClient is HttpEventClient
```

Reinstall both editables together (the shim's dependency resolves to the local checkout):
```bash
uv pip install --python .venv -e "python-server[dev]" -e integrations/agenttrace-langchain
.venv/bin/pytest python-server/tests -q
.venv/bin/pytest integrations/agenttrace-langchain/tests -q
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A python-server integrations/agenttrace-langchain
git commit -m "refactor: move LangChain integration into agenttrace.langchain; agenttrace-langchain becomes a shim"
```

---

### Task 10: `AgentTraceCallbackHandler` + `autolog()`

**Files:**
- Create: `python-server/agenttrace/langchain/callback.py`, `python-server/agenttrace/langchain/autolog.py`
- Modify: `python-server/agenttrace/langchain/__init__.py`
- Test: `python-server/tests/langchain/test_callback.py`, `python-server/tests/langchain/test_autolog.py`

**Interfaces:**
- Consumes: Task 6 `active_run`, `_new_run`-style creation via `agenttrace.tracking.fluent` (`get_project`, `_forget` not needed — use `ActiveRun(store_for_uri(get_tracking_uri()), name, project=get_project())`), Task 9 middleware helpers `HANDOFF_MARKERS, _extract_handoff_target, _result_content, _token_usage`, Task 5 limits/helpers.
- Produces: `AgentTraceCallbackHandler(orchestrator: str = "Orchestrator")` with attribute `enabled: bool`; `autolog(disable: bool = False) -> None`; both exported from `agenttrace.langchain`.

- [ ] **Step 1: Write the failing tests**

`python-server/tests/langchain/test_callback.py`:
```python
import pytest
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage
from langchain_core.runnables import RunnableLambda
from langchain_core.tools import tool

import agenttrace
from agenttrace.langchain import AgentTraceCallbackHandler
from tests.conftest import read_runs


@tool
def add(a: int, b: int) -> int:
    """Add two integers."""
    return a + b


@tool
def explode(x: int) -> int:
    """Always fails."""
    raise ValueError("kaboom")


def _model():
    return GenericFakeChatModel(messages=iter([AIMessage(content="the answer is 3")]))


def _pipeline(model):
    def run(question: str) -> dict:
        total = add.invoke({"a": 1, "b": 2})
        reply = model.invoke(f"{question} {total}")
        return {"messages": [reply]}

    return RunnableLambda(run, name="pipeline")


def test_handler_maps_a_root_invocation_to_one_run(tracking_db):
    handler = AgentTraceCallbackHandler()
    _pipeline(_model()).invoke("sum?", config={"callbacks": [handler]})
    [run] = read_runs(tracking_db)
    assert run["name"] == "pipeline" and run["status"] == "completed"
    types = [(e["type"], e["source"], e["target"]) for e in run["events"]]
    assert types[0] == ("tool_call", "Orchestrator", "add")
    assert types[1] == ("tool_result", "add", "Orchestrator")
    assert types[2][0] == "llm_call" and types[2][1] == "Orchestrator"
    assert types[3] == ("final_answer", "Orchestrator", "User")
    assert run["events"][3]["payload"]["answer"] == "the answer is 3"


def test_tool_error_is_recorded_and_root_failure_fails_run(tracking_db):
    chain = RunnableLambda(lambda x: explode.invoke({"x": x}), name="failing")
    with pytest.raises(ValueError):
        chain.invoke(1, config={"callbacks": [AgentTraceCallbackHandler()]})
    [run] = read_runs(tracking_db)
    assert run["status"] == "failed"
    assert [e["type"] for e in run["events"]] == ["tool_call", "error"]


def test_reuses_active_fluent_run_without_closing_it(tracking_db):
    with agenttrace.start_run("outer"):
        _pipeline(_model()).invoke("sum?", config={"callbacks": [AgentTraceCallbackHandler()]})
        agenttrace.log_event(source="me", target="you", type="tool_call")
    [run] = read_runs(tracking_db)
    assert run["name"] == "outer"
    assert [e["type"] for e in run["events"]][-1] == "tool_call"  # still open after the chain ended


def test_handoff_tool_emits_handoff(tracking_db):
    @tool
    def handoff_to_researcher(to: str) -> str:
        """Delegate."""
        return "ok"

    chain = RunnableLambda(lambda x: handoff_to_researcher.invoke({"to": "Researcher"}), name="delegating")
    chain.invoke(None, config={"callbacks": [AgentTraceCallbackHandler()]})
    events = read_runs(tracking_db)[0]["events"]
    assert ("handoff", "Researcher") in [(e["type"], e["target"]) for e in events]


def test_handler_errors_never_propagate(tracking_db, monkeypatch):
    handler = AgentTraceCallbackHandler()
    monkeypatch.setattr(handler, "_root_state", lambda *a, **k: 1 / 0)
    assert _pipeline(_model()).invoke("sum?", config={"callbacks": [handler]})["messages"]
```

`python-server/tests/langchain/test_autolog.py`:
```python
import threading

from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage
from langchain_core.runnables import RunnableLambda

import agenttrace.langchain
from tests.conftest import read_runs


def _chain():
    model = GenericFakeChatModel(messages=iter([AIMessage(content="hi")]))
    return RunnableLambda(lambda q: {"messages": [model.invoke(q)]}, name="autologged")


def test_autolog_traces_without_explicit_callbacks(tracking_db):
    agenttrace.langchain.autolog()
    try:
        _chain().invoke("hello")
    finally:
        agenttrace.langchain.autolog(disable=True)
    [run] = read_runs(tracking_db)
    assert run["name"] == "autologged"
    assert [e["type"] for e in run["events"]] == ["llm_call", "final_answer"]


def test_autolog_disable_stops_tracing(tracking_db):
    agenttrace.langchain.autolog()
    agenttrace.langchain.autolog()  # idempotent
    agenttrace.langchain.autolog(disable=True)
    _chain().invoke("hello")
    assert read_runs(tracking_db) == []


def test_autolog_traces_invocations_from_other_threads(tracking_db):
    """Review focus #4: e.g. a FastAPI threadpool worker."""
    agenttrace.langchain.autolog()
    try:
        t = threading.Thread(target=lambda: _chain().invoke("from thread"))
        t.start()
        t.join()
    finally:
        agenttrace.langchain.autolog(disable=True)
    assert len(read_runs(tracking_db)) == 1
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/pytest python-server/tests/langchain/test_callback.py python-server/tests/langchain/test_autolog.py -q`
Expected: FAIL — `ImportError: cannot import name 'AgentTraceCallbackHandler'`.

- [ ] **Step 3: Implement**

`python-server/agenttrace/langchain/callback.py`:
```python
"""AgentTraceCallbackHandler — LangChain callbacks -> AgentTrace events.

Unlike the middleware (baked into one agent graph), a callback handler can
be attached globally, which is what `autolog()` does. Each root invocation
(a callback with `parent_run_id is None`) becomes one AgentTrace run, unless
a fluent run is already active — then events join it and it stays open.
Children are mapped to their root through `parent_run_id`, so concurrent
invocations never mix. Handler methods never raise.
"""

from __future__ import annotations

import functools
import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Optional
from uuid import UUID

from langchain_core.callbacks import BaseCallbackHandler

from ..tracking import fluent
from ..tracking._uri import get_tracking_uri
from ..tracking.run import ANSWER_LIMIT, LABEL_LIMIT, RESULT_LIMIT, ActiveRun, compact, truncate
from ..tracking.stores import store_for_uri
from .middleware import HANDOFF_MARKERS, _extract_handoff_target, _result_content, _token_usage

logger = logging.getLogger(__name__)


def _never_raise(method):
    @functools.wraps(method)
    def wrapper(self, *args, **kwargs):
        if not self.enabled:
            return None
        try:
            return method(self, *args, **kwargs)
        except Exception:  # noqa: BLE001 - tracing must never break the agent
            logger.debug("AgentTrace callback %s failed", method.__name__, exc_info=True)
            return None

    return wrapper


@dataclass
class _RootState:
    run: ActiveRun
    owned: bool
    started: dict[UUID, float] = field(default_factory=dict)
    names: dict[UUID, str] = field(default_factory=dict)
    had_error: bool = False


class AgentTraceCallbackHandler(BaseCallbackHandler):
    raise_error = False

    def __init__(self, orchestrator: str = "Orchestrator"):
        self.orchestrator = orchestrator
        self.enabled = True
        self._lock = threading.Lock()
        self._root_of: dict[UUID, UUID] = {}
        self._roots: dict[UUID, _RootState] = {}

    # ----- run bookkeeping -----
    def _root_state(self, run_id: UUID, parent_run_id: Optional[UUID], name: str) -> _RootState:
        with self._lock:
            root = run_id if parent_run_id is None else self._root_of.get(parent_run_id, parent_run_id)
            self._root_of[run_id] = root
            state = self._roots.get(root)
            if state is None:
                active = fluent.active_run()
                if active is not None:
                    state = _RootState(run=active, owned=False)
                else:
                    run = ActiveRun(store_for_uri(get_tracking_uri()), name, project=fluent.get_project())
                    state = _RootState(run=run, owned=True)
                self._roots[root] = state
            return state

    def _lookup(self, run_id: UUID) -> Optional[_RootState]:
        with self._lock:
            root = self._root_of.get(run_id)
            return self._roots.get(root) if root is not None else None

    def _finish_root(self, run_id: UUID, status: str, answer: Optional[str]) -> None:
        with self._lock:
            state = self._roots.pop(run_id, None)
            for child in [c for c, r in self._root_of.items() if r == run_id]:
                del self._root_of[child]
        if state is None:
            return
        if answer is not None:
            state.run.log_event(
                source=self.orchestrator,
                target="User",
                type="final_answer",
                label="final answer",
                payload={"answer": truncate(answer, ANSWER_LIMIT)},
            )
        if state.owned:
            state.run.end("failed" if status == "failed" else status)
            state.run.close()

    def _elapsed_ms(self, state: _RootState, run_id: UUID) -> Optional[int]:
        started = state.started.pop(run_id, None)
        return int((time.monotonic() - started) * 1000) if started is not None else None

    # ----- chains (only roots matter) -----
    @_never_raise
    def on_chain_start(self, serialized, inputs, *, run_id, parent_run_id=None, **kwargs):
        name = kwargs.get("name") or (serialized or {}).get("name") or "langchain run"
        self._root_state(run_id, parent_run_id, str(name))

    @_never_raise
    def on_chain_end(self, outputs, *, run_id, parent_run_id=None, **kwargs):
        if parent_run_id is None:
            state = self._lookup(run_id)
            status = "failed" if state is not None and state.had_error else "completed"
            self._finish_root(run_id, status, _answer_text(outputs))

    @_never_raise
    def on_chain_error(self, error, *, run_id, parent_run_id=None, **kwargs):
        if parent_run_id is None:
            self._finish_root(run_id, "failed", None)

    # ----- LLM calls -----
    @_never_raise
    def on_chat_model_start(self, serialized, messages, *, run_id, parent_run_id=None, **kwargs):
        self._llm_start(serialized, run_id, parent_run_id, kwargs)

    @_never_raise
    def on_llm_start(self, serialized, prompts, *, run_id, parent_run_id=None, **kwargs):
        self._llm_start(serialized, run_id, parent_run_id, kwargs)

    def _llm_start(self, serialized, run_id, parent_run_id, kwargs) -> None:
        model = _model_name(serialized, kwargs)
        state = self._root_state(run_id, parent_run_id, model)
        state.started[run_id] = time.monotonic()
        state.names[run_id] = model

    @_never_raise
    def on_llm_end(self, response, *, run_id, parent_run_id=None, **kwargs):
        state = self._lookup(run_id)
        if state is None:
            return
        message = _first_generation_message(response)
        state.run.log_event(
            source=self.orchestrator,
            target=state.names.pop(run_id, "LLM"),
            type="llm_call",
            label="llm step",
            payload={
                "output_preview": truncate(str(_result_content(message)), 240),
                "tokens": _token_usage(message),
            },
            duration_ms=self._elapsed_ms(state, run_id),
        )
        if parent_run_id is None:
            self._finish_root(run_id, "completed", None)

    @_never_raise
    def on_llm_error(self, error, *, run_id, parent_run_id=None, **kwargs):
        state = self._lookup(run_id)
        if state is None:
            return
        state.had_error = True
        state.run.log_event(
            source=state.names.pop(run_id, "LLM"),
            target=self.orchestrator,
            type="error",
            label="llm failed",
            payload={"error": type(error).__name__, "message": str(error)},
            status="error",
        )
        if parent_run_id is None:
            self._finish_root(run_id, "failed", None)

    # ----- tools -----
    @_never_raise
    def on_tool_start(self, serialized, input_str, *, run_id, parent_run_id=None, inputs=None, **kwargs):
        tool_name = str((serialized or {}).get("name") or kwargs.get("name") or "tool")
        state = self._root_state(run_id, parent_run_id, tool_name)
        state.started[run_id] = time.monotonic()
        state.names[run_id] = tool_name
        args = inputs if inputs is not None else input_str
        state.run.log_event(
            source=self.orchestrator,
            target=tool_name,
            type="tool_call",
            label=f"{tool_name}({truncate(str(args), LABEL_LIMIT)})",
            payload={"args": compact(args)},
        )
        if any(marker in tool_name.lower() for marker in HANDOFF_MARKERS):
            sub_agent = (_extract_handoff_target(args) if isinstance(args, dict) else None) or "Sub-agent"
            state.run.log_event(
                source=self.orchestrator,
                target=sub_agent,
                type="handoff",
                label=f"delegate → {sub_agent}",
                payload={"task": compact(args, 200)},
            )

    @_never_raise
    def on_tool_end(self, output, *, run_id, parent_run_id=None, **kwargs):
        state = self._lookup(run_id)
        if state is None:
            return
        tool_name = state.names.pop(run_id, "tool")
        state.run.log_event(
            source=tool_name,
            target=self.orchestrator,
            type="tool_result",
            label=f"{tool_name} → result",
            payload={"result": truncate(str(_result_content(output)), RESULT_LIMIT)},
            duration_ms=self._elapsed_ms(state, run_id),
        )
        if parent_run_id is None:
            self._finish_root(run_id, "completed", None)

    @_never_raise
    def on_tool_error(self, error, *, run_id, parent_run_id=None, **kwargs):
        state = self._lookup(run_id)
        if state is None:
            return
        state.had_error = True
        tool_name = state.names.pop(run_id, "tool")
        state.run.log_event(
            source=tool_name,
            target=self.orchestrator,
            type="error",
            label=f"{tool_name} failed",
            payload={"error": type(error).__name__, "message": str(error)},
            status="error",
        )
        if parent_run_id is None:
            self._finish_root(run_id, "failed", None)


def _model_name(serialized: Any, kwargs: dict) -> str:
    metadata = kwargs.get("metadata") or {}
    params = kwargs.get("invocation_params") or {}
    name = metadata.get("ls_model_name") or params.get("model") or params.get("model_name")
    return str(name or (serialized or {}).get("name") or "LLM")


def _first_generation_message(response: Any) -> Any:
    try:
        generation = response.generations[0][0]
    except (AttributeError, IndexError, TypeError):
        return response
    return getattr(generation, "message", None) or generation


def _answer_text(outputs: Any) -> str:
    if isinstance(outputs, dict):
        messages = outputs.get("messages")
        if messages:
            content = getattr(messages[-1], "content", messages[-1])
            return content if isinstance(content, str) else str(content)
        if "output" in outputs:
            return str(outputs["output"])
    content = getattr(outputs, "content", outputs)
    return content if isinstance(content, str) else str(content)
```

Note on `test_tool_error_is_recorded_and_root_failure_fails_run`: the tool error marks `had_error`; `on_chain_error` on the root then ends the run `failed`. On `on_chain_end` after a swallowed tool error, the run ends `failed` too (mirrors the middleware's `_had_error`).

`python-server/agenttrace/langchain/autolog.py`:
```python
"""`agenttrace.langchain.autolog()` — trace every LangChain/deepagents
invocation in the process without touching agent code (MLflow-style).

LangChain consults hooks registered with `register_configure_hook` when it
builds each invocation's callback manager. The ContextVar's *default* is the
shared handler (not a value set in the current context), so invocations on
threads started anywhere — e.g. a FastAPI threadpool — are traced too.
`disable=True` flips the handler off instead of unregistering (LangChain has
no unregister API).
"""

from __future__ import annotations

import threading
from contextvars import ContextVar
from typing import Optional

from langchain_core.tracers.context import register_configure_hook

from .callback import AgentTraceCallbackHandler

_handler: Optional[AgentTraceCallbackHandler] = None
_lock = threading.Lock()


def autolog(disable: bool = False) -> None:
    global _handler
    with _lock:
        if _handler is None:
            if disable:
                return
            _handler = AgentTraceCallbackHandler()
            hook: ContextVar[Optional[AgentTraceCallbackHandler]] = ContextVar(
                "agenttrace_autolog_handler", default=_handler
            )
            register_configure_hook(hook, inheritable=True)
        _handler.enabled = not disable
```

`python-server/agenttrace/langchain/__init__.py` — extend:
```python
from .autolog import autolog
from .callback import AgentTraceCallbackHandler
from .middleware import AgentTraceMiddleware

__all__ = ["AgentTraceCallbackHandler", "AgentTraceMiddleware", "autolog"]
```

- [ ] **Step 4: Run to verify pass**

Run: `.venv/bin/pytest python-server/tests -q` → PASS.

If `test_handler_maps_a_root_invocation_to_one_run` shows the tool/LLM events in a separate run, nested invokes inside `RunnableLambda` didn't receive `parent_run_id`: check that the lambda's function accepts no `config` param — langchain_core ≥1.0 propagates the child config through `var_child_runnable_config` automatically on Python ≥3.11; on 3.10 the test environment must use 3.11+ (CI uses 3.12).

- [ ] **Step 5: Commit**

```bash
git add -A python-server
git commit -m "feat: LangChain callback handler and agenttrace.langchain.autolog()"
```

---

### Task 11: CI job, docs, success-criterion check

**Files:**
- Modify: `.github/workflows/ci.yml`, `README.md`, `python-server/README.md`, `integrations/agenttrace-langchain/README.md`, `python-server/pyproject.toml` (version)
- Test: `python-server/tests/test_success_criterion.py`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write the end-to-end success-criterion test**

`python-server/tests/test_success_criterion.py`:
```python
"""The spec's success criterion, verbatim: no key, no server, autolog, and the
run lands in ./agenttrace.db where `agenttrace ui` reads it."""

import os
import subprocess
import sys
import textwrap

from tests.conftest import read_runs


def test_zero_config_autolog_script_writes_local_db(tmp_path):
    script = textwrap.dedent("""
        from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
        from langchain_core.messages import AIMessage
        from langchain_core.runnables import RunnableLambda

        import agenttrace
        import agenttrace.langchain

        agenttrace.set_project("support-bot")
        agenttrace.langchain.autolog()
        model = GenericFakeChatModel(messages=iter([AIMessage(content="hello")]))
        agent = RunnableLambda(lambda q: {"messages": [model.invoke(q)]}, name="agent")
        agent.invoke("hi")
    """)
    env = {k: v for k, v in os.environ.items() if not k.startswith("AGENTTRACE_") and k != "DATABASE_URL"}
    subprocess.run([sys.executable, "-c", script], cwd=tmp_path, env=env, check=True, timeout=120)
    [run] = read_runs(f"sqlite:///{tmp_path}/agenttrace.db")
    assert run["project"] == "support-bot" and run["status"] == "completed"
    assert [e["type"] for e in run["events"]] == ["llm_call", "final_answer"]
```

- [ ] **Step 2: Run it**

Run: `.venv/bin/pytest python-server/tests/test_success_criterion.py -q`
Expected: PASS (all features exist). If it fails, the failure points at an integration gap between tasks — fix it in the owning module, not in the test.

- [ ] **Step 3: Add the CI job**

Append to `jobs:` in `.github/workflows/ci.yml` (and add `#   5. python tests (pytest, server + SDK + shim)` to the header comment):
```yaml
  # ────────────────────────────────────────────────────────────
  # Python package (deepagents-trace) + legacy shim
  # ────────────────────────────────────────────────────────────
  python:
    name: python tests
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup uv
        uses: astral-sh/setup-uv@v6

      - name: Install
        run: |
          uv venv .venv --python 3.12
          uv pip install --python .venv -e "python-server[dev]" -e integrations/agenttrace-langchain

      - name: Test
        run: |
          .venv/bin/pytest python-server/tests -q
          .venv/bin/pytest integrations/agenttrace-langchain/tests -q
```

- [ ] **Step 4: Update docs**

`python-server/README.md` — replace the "Install & run" section with:
````markdown
## Quick start (MLflow-style)

```bash
pip install 'deepagents-trace[langchain,server]'
```

```python
import agenttrace
import agenttrace.langchain

agenttrace.set_project("support-bot")      # like mlflow.set_experiment
agenttrace.langchain.autolog()             # like mlflow.langchain.autolog
agent.invoke({"messages": [...]})          # traced into ./agenttrace.db
```

```bash
agenttrace ui                              # http://127.0.0.1:3000, reads ./agenttrace.db, no login
```

Manual tracing:

```python
with agenttrace.start_run("triage"):
    agenttrace.log_event(source="Orchestrator", target="LLM", type="llm_call", duration_ms=420)

@agenttrace.trace                          # tool_call -> tool_result | error
def web_search(query: str) -> str: ...
```

| MLflow | AgentTrace |
| --- | --- |
| `mlflow.set_tracking_uri()` / `MLFLOW_TRACKING_URI` | `agenttrace.set_tracking_uri()` / `AGENTTRACE_TRACKING_URI` |
| `mlflow.set_experiment()` | `agenttrace.set_project()` / `AGENTTRACE_PROJECT` |
| `mlflow.start_run()` / `active_run()` / `end_run()` | same names |
| `@mlflow.trace` | `@agenttrace.trace` |
| `mlflow.langchain.autolog()` | `agenttrace.langchain.autolog()` |
| `MlflowClient` | `agenttrace.AgentTraceClient` |
| `mlflow ui` | `agenttrace ui` |

Tracking URIs: unset → `sqlite:///./agenttrace.db`; any SQLAlchemy URL (e.g.
`postgresql://…`) → written directly; `http(s)://host:port` → sent to a
running `agenttrace ui` (set `AGENTTRACE_KEY` if that server uses
`--auth password`).

`agenttrace ui --auth none` (default on localhost) needs no account or API
key; `--auth password` (default on any other host) keeps accounts and
`atr_` project keys.
````
Also: replace the extras sentence ("For local development…") with `pip install -e "python-server[dev]"`, and add one line under "Known gaps": "Live updates are polled from the database every 0.5 s (so direct SQLite writes appear live)."

`README.md` — in "Python backend + CLI" add a 3-line pointer to the quick start above; in "DeepAgents (LangChain)" replace `pip install -e integrations/agenttrace-langchain` / `from agenttrace_langchain import AgentTraceMiddleware` with `pip install 'deepagents-trace[langchain]'` / `from agenttrace.langchain import AgentTraceMiddleware`, and add: "Or skip the middleware entirely: `agenttrace.langchain.autolog()`."

`integrations/agenttrace-langchain/README.md` — prepend:
```markdown
> **Deprecated.** This package is now a thin shim. Use
> `pip install 'deepagents-trace[langchain]'` and `import agenttrace.langchain`
> (or `agenttrace.langchain.autolog()`). Existing imports keep working and emit
> a `DeprecationWarning`.
```

- [ ] **Step 5: Full verification**

```bash
.venv/bin/pytest python-server/tests -q
.venv/bin/pytest integrations/agenttrace-langchain/tests -q
uv build python-server --out-dir /tmp/claude-1000/agenttrace-dist
```
Expected: all tests PASS; build produces a wheel and sdist. Then in a clean venv, check the core install has no server deps and the CLI hint works:
```bash
uv venv /tmp/claude-1000/core-venv --python 3.12
uv pip install --python /tmp/claude-1000/core-venv /tmp/claude-1000/agenttrace-dist/*.whl
/tmp/claude-1000/core-venv/bin/python -c "import agenttrace; agenttrace.log_event(source='a', target='b', type='tool_call')"
/tmp/claude-1000/core-venv/bin/agenttrace ui; echo "exit=$?"
```
Expected: the import/log works (writes `./agenttrace.db` in the cwd — run it from a temp dir and delete it after); `agenttrace ui` prints the `pip install 'deepagents-trace[server]'` hint with `exit=1`.

- [ ] **Step 6: Commit**

```bash
git add -A .github python-server README.md integrations/agenttrace-langchain
git commit -m "docs: MLflow-style quick start and CI python job"
```
