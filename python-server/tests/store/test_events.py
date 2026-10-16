import json

import pytest

from lanetrace.store import db as store_db
from lanetrace.store import events, local, models


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


def test_append_event_encodes_non_json_payload_values(session):
    from pathlib import Path

    user = local.get_or_create_local_user(session)
    run = events.create_run(session, local.get_or_create_project(session, user, "p").id, "r")
    event = events.append_event(session, run.id, {"source": "a", "target": "b", "type": "tool_call", "payload": {"p": Path("/a")}})
    assert json.loads(event.payload) == {"p": "/a"}


def test_project_created_by_another_process_meanwhile_wins(session, monkeypatch):
    """Cross-process race: the older same-name project is kept, ours is deleted."""
    user = local.get_or_create_local_user(session)
    older = local.get_or_create_project(session, user, "p")
    real = local._projects_named
    calls = []

    def racing(db, u, name):
        calls.append(name)
        query = real(db, u, name)
        return query.filter(models.Project.id == "none") if len(calls) == 1 else query

    monkeypatch.setattr(local, "_projects_named", racing)
    assert local.get_or_create_project(session, user, "p").id == older.id
    assert session.query(models.Project).filter(models.Project.name == "p").count() == 1
