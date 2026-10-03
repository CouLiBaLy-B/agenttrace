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
