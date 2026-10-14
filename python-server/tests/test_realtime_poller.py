import os
import uuid

import pytest
from starlette.websockets import WebSocketDisconnect
from fastapi.testclient import TestClient

from agenttrace.server.app import app
from agenttrace.tracking.stores.sql import SqlStore


@pytest.fixture(autouse=True)
def _local_mode(request, monkeypatch):
    # Runs created via SqlStore belong to the `local` user, so use keyless mode
    # (except in the password-mode authorization tests below).
    if "password_mode" in request.node.name:
        return
    monkeypatch.setenv("AGENTTRACE_AUTH", "none")
    monkeypatch.setenv("AGENTTRACE_ALLOWED_HOSTS", "testserver")


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
        assert update["patch"]["endedAt"].endswith("+00:00")


def test_run_state_emits_utc_offset_for_naive_datetimes():
    from datetime import datetime

    from agenttrace.server import models
    from agenttrace.server.realtime import _run_state

    run = models.Run(status="completed", ended_at=datetime(2026, 10, 1, 12, 0, 0))
    assert _run_state(run) == ("completed", "2026-10-01T12:00:00+00:00")
    assert _run_state(models.Run(status="running", ended_at=None)) == ("running", None)


def test_poll_once_ignores_runs_without_subscribers():
    from agenttrace.server.realtime import ConnectionManager

    store = SqlStore(os.environ["DATABASE_URL"])
    run_id = store.create_run("direct", "nobody watching")
    store.log_event(run_id, {"source": "a", "target": "b", "type": "tool_call"})
    assert ConnectionManager().poll_once() == []


def _subscribe(ws, run_id):
    ws.send_json({"action": "subscribe", "runId": run_id})
    return ws.receive_json()


def test_resubscribe_does_not_replay_old_events_and_cursors_are_cleared():
    from agenttrace.server.realtime import manager

    store = SqlStore(os.environ["DATABASE_URL"])
    run_id = store.create_run("direct", "resub")
    with TestClient(app) as client, client.websocket_connect("/ws") as ws:
        assert _subscribe(ws, run_id)["type"] == "subscribed"
        store.log_event(run_id, {"source": "a", "target": "first", "type": "tool_call"})
        assert ws.receive_json()["data"]["target"] == "first"
        ws.send_json({"action": "unsubscribe", "runId": run_id})
        store.log_event(run_id, {"source": "a", "target": "second", "type": "tool_call"})
        import time

        time.sleep(1.2)  # a couple of poll cycles while unwatched
        assert run_id not in manager._last_seq and run_id not in manager._rooms
        assert _subscribe(ws, run_id)["type"] == "subscribed"
        store.log_event(run_id, {"source": "a", "target": "third", "type": "tool_call"})
        assert ws.receive_json()["data"]["target"] == "third"  # first/second are not replayed
    assert run_id not in manager._last_seq


def test_subscribe_unknown_run_errors_and_creates_no_room():
    from agenttrace.server.realtime import manager

    with TestClient(app) as client, client.websocket_connect("/ws") as ws:
        assert _subscribe(ws, "nope") == {"type": "error", "runId": "nope", "error": "Run not found"}
        assert "nope" not in manager._rooms and "nope" not in manager._last_seq


def test_subscription_cap_per_socket():
    from agenttrace.server.realtime import MAX_SUBSCRIPTIONS_PER_SOCKET

    store = SqlStore(os.environ["DATABASE_URL"])
    run_ids = [store.create_run("direct", f"cap {i}") for i in range(MAX_SUBSCRIPTIONS_PER_SOCKET + 1)]
    with TestClient(app) as client, client.websocket_connect("/ws") as ws:
        for run_id in run_ids[:-1]:
            assert _subscribe(ws, run_id)["type"] == "subscribed"
        assert _subscribe(ws, run_ids[-1]) == {
            "type": "error",
            "runId": run_ids[-1],
            "error": "Too many subscriptions",
        }


def test_poll_does_not_resurrect_cursor_of_forgotten_run():
    import asyncio

    from agenttrace.server.realtime import ConnectionManager

    class FakeWs:
        pass

    store = SqlStore(os.environ["DATABASE_URL"])
    run_id = store.create_run("direct", "race")
    mgr = ConnectionManager()
    ws = FakeWs()
    mgr._last_seq[run_id] = -1
    mgr._rooms[run_id] = {ws}
    snapshot = mgr._snapshot()
    store.log_event(run_id, {"source": "a", "target": "b", "type": "tool_call"})
    messages, updates = mgr._poll_snapshot(snapshot)
    assert len(messages) == 1
    mgr._rooms[run_id].discard(ws)  # unsubscribe lands between snapshot and apply
    mgr._forget_if_empty(run_id)
    mgr._apply(updates)
    assert run_id not in mgr._last_seq and run_id not in mgr._run_state


def _signup(client):
    resp = client.post(
        "/api/auth/signup",
        json={"email": f"{uuid.uuid4().hex}@example.com", "password": "secret123", "name": "T"},
    )
    assert resp.status_code == 201, resp.text


def _make_run(client):
    project = client.post("/api/projects", json={"name": "p"}).json()
    headers = {"Authorization": f"Bearer {project['apiKey']}"}
    return client.post("/api/events", json={"runId": None, "name": "r"}, headers=headers).json()["runId"], headers


def test_ws_refused_without_session_password_mode():
    with TestClient(app) as client:
        with pytest.raises(WebSocketDisconnect) as exc:
            with client.websocket_connect("/ws"):
                pass
        assert exc.value.code == 1008


def test_ws_owner_subscribes_and_other_user_gets_not_found_password_mode():
    with TestClient(app) as owner, TestClient(app) as other:
        _signup(owner)
        _signup(other)
        run_id, headers = _make_run(owner)
        with other.websocket_connect("/ws") as ws:
            assert _subscribe(ws, run_id) == {"type": "error", "runId": run_id, "error": "Run not found"}
        with owner.websocket_connect("/ws") as ws:
            assert _subscribe(ws, run_id)["type"] == "subscribed"
            owner.post(
                "/api/events",
                json={"runId": run_id, "source": "a", "target": "b", "type": "tool_call"},
                headers=headers,
            )
            assert ws.receive_json()["type"] == "event"
            # a cached cursor must not let another user in
            with other.websocket_connect("/ws") as ws2:
                assert _subscribe(ws2, run_id)["error"] == "Run not found"
