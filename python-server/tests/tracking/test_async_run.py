import json

import httpx
import pytest

from agenttrace.tracking.async_http import AsyncHttpEventClient as AsyncAgentTraceClient
from agenttrace.tracking.async_run import AsyncAgentTraceRun


@pytest.fixture
def post(mocker):
    post = mocker.patch("httpx.AsyncClient.post")
    response = mocker.Mock()
    response.raise_for_status.return_value = None
    response.json.return_value = {"runId": "run_1", "event": {}}
    post.return_value = response
    return post


@pytest.fixture
async def run(post):
    client = AsyncAgentTraceClient(url="http://localhost:3000/api/events", api_key="atr_test")
    return AsyncAgentTraceRun("test run", client=client)


def _bodies(post):
    return [call.kwargs["json"] for call in post.call_args_list]


async def test_on_user_message_emits_handoff(run, post):
    run.on_user_message("hello agent")
    await run.aclose(timeout=2.0)

    bodies = _bodies(post)
    assert bodies[0] == {"runId": None, "name": "test run"}
    assert bodies[1]["type"] == "handoff"
    assert bodies[1]["source"] == "User"
    assert bodies[1]["target"] == "Orchestrator"


async def test_on_stream_event_tool_call_and_result(run, post):
    run.on_stream_event("tool_call", "main", {"id": "call_1", "name": "web_search", "args": {"query": "q"}})
    run.on_stream_event("tool_result", "main", {"id": "call_1", "name": "web_search", "result": "ok"})
    await run.aclose(timeout=2.0)

    events = [b for b in _bodies(post) if "type" in b]
    assert events[0]["type"] == "tool_call"
    assert events[0]["target"] == "web_search"
    assert events[1]["type"] == "tool_result"
    assert events[1]["source"] == "web_search"
    assert "durationMs" in events[1]


async def test_on_stream_event_skips_task_delegation_tool(run, post):
    run.on_stream_event("tool_call", "main", {"id": "1", "name": "task", "args": {}})
    run.end("completed")
    await run.aclose(timeout=2.0)

    events = [b for b in _bodies(post) if "type" in b]
    assert events == []


async def test_on_stream_event_subagent_handoff(run, post):
    run.on_stream_event("agent_start", "researcher", {"scope": "subagent", "label": "research task"})
    run.on_stream_event("agent_end", "researcher", {"scope": "subagent", "status": "completed"})
    await run.aclose(timeout=2.0)

    events = [b for b in _bodies(post) if "type" in b]
    assert events[0]["type"] == "handoff"
    assert events[0]["target"] == "researcher"
    assert events[1]["type"] == "tool_result"
    assert events[1]["source"] == "researcher"


async def test_on_stream_event_failed_subagent_emits_error(run, post):
    run.on_stream_event("agent_end", "researcher", {"scope": "subagent", "status": "failed", "error": "boom"})
    await run.aclose(timeout=2.0)

    events = [b for b in _bodies(post) if "type" in b]
    assert events[0]["type"] == "error"
    assert events[0]["status"] == "error"


async def test_on_stream_event_final_answer(run, post):
    run.on_stream_event("final", "main", {"message": "the final answer"})
    await run.aclose(timeout=2.0)

    events = [b for b in _bodies(post) if "type" in b]
    assert events[0]["type"] == "final_answer"
    assert events[0]["payload"]["answer"] == "the final answer"


async def test_custom_phrases_override_default_labels(post):
    client = AsyncAgentTraceClient(url="http://localhost:3000/api/events", api_key="atr_test")
    run = AsyncAgentTraceRun(
        "test run",
        client=client,
        phrases={
            "delegate": "délégation → {target}",
            "subagent_failed": "{name} → échec",
            "final_answer": "réponse finale",
        },
    )

    run.on_stream_event("agent_start", "researcher", {"scope": "subagent", "label": "task"})
    run.on_stream_event("agent_end", "researcher", {"scope": "subagent", "status": "failed", "error": "boom"})
    run.on_stream_event("final", "main", {"message": "voila"})
    await run.aclose(timeout=2.0)

    events = [b for b in _bodies(post) if "type" in b]
    assert events[0]["label"] == "délégation → researcher"
    assert events[1]["label"] == "researcher → échec"
    assert events[2]["label"] == "réponse finale"


async def test_tool_server_callback_enriches_payload(post):
    client = AsyncAgentTraceClient(url="http://localhost:3000/api/events", api_key="atr_test")
    run = AsyncAgentTraceRun("test run", client=client, tool_server=lambda name: "iam-mcp")
    run.on_stream_event("tool_call", "main", {"id": "1", "name": "iam_list_users", "args": {}})
    await run.aclose(timeout=2.0)

    events = [b for b in _bodies(post) if "type" in b]
    assert events[0]["payload"]["server"] == "iam-mcp"


async def test_on_error_and_end_failed_are_sent(run, post):
    run.on_error("boom")
    run.end("failed")
    await run.aclose(timeout=2.0)

    bodies = _bodies(post)
    assert bodies[1]["type"] == "error" and bodies[1]["status"] == "error"
    assert bodies[-1] == {"runId": "run_1", "endRun": "failed"}


async def test_keyed_request_sends_bearer_and_no_project(run, post):
    run.on_user_message("hi")
    await run.aclose(timeout=2.0)

    assert post.call_args_list[0].kwargs["headers"]["Authorization"] == "Bearer atr_test"
    assert "project" not in _bodies(post)[0]


async def test_anonymizer_applied_to_every_payload_label_and_run_name(post):
    def scrub(value):
        if isinstance(value, str):
            return value.replace("Jane Doe", "<name>")
        return {"masked": True}

    client = AsyncAgentTraceClient(url="http://localhost:3000/api/events", api_key="atr_test")
    run = AsyncAgentTraceRun("chat with Jane Doe", client=client, anonymizer=scrub)
    run.on_user_message("Jane Doe, SSN 123")
    run.on_stream_event("agent_start", "researcher", {"scope": "subagent", "label": "look up Jane Doe"})
    run.on_stream_event("final", "main", {"message": "Jane Doe is fine"})
    await run.aclose(timeout=2.0)

    bodies = _bodies(post)
    assert bodies[0]["name"] == "chat with <name>"
    events = [b for b in bodies if "type" in b]
    assert len(events) == 3
    assert all(e["payload"] == {"masked": True} for e in events)
    assert events[0]["label"] == "<name>, SSN 123"
    assert "Jane Doe" not in str(bodies)


async def test_failing_anonymizer_fails_closed_and_warns_once(post, caplog):
    def broken(value):
        raise RuntimeError("scrubber down for Jane Doe")

    client = AsyncAgentTraceClient(url="http://localhost:3000/api/events", api_key="atr_test")
    run = AsyncAgentTraceRun("run for Jane Doe", client=client, anonymizer=broken)
    run.on_user_message("Jane Doe, SSN 123")
    run.on_stream_event("final", "main", {"message": "Jane Doe is fine"})
    queued = list(run._queue._queue)  # what was actually enqueued
    await run.aclose(timeout=2.0)

    assert "Jane Doe" not in str(queued)
    bodies = _bodies(post)
    assert "Jane Doe" not in str(bodies)
    assert bodies[0]["name"] == "[redacted]"
    events = [b for b in bodies if "type" in b]
    assert len(events) == 2  # events kept so the diagram stays coherent
    assert all(e["payload"] == {"redacted": "anonymizer failed"} for e in events)
    assert all(e["label"] == "[redacted]" for e in events)
    warnings = [r for r in caplog.records if "anonymizer" in r.getMessage()]
    assert len(warnings) == 1
    assert "Jane Doe" not in warnings[0].getMessage()


# ----- anonymize the full value, THEN truncate -----

TOKEN = "ID-739104628351"  # 15 chars


def _scrub(value):
    import re

    if isinstance(value, str):
        return re.sub(r"ID-\d{12}", "<id>", value)
    if isinstance(value, dict):
        return {k: _scrub(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_scrub(v) for v in value]
    return value


def _straddle(limit):
    """Text whose TOKEN starts 5 chars before `limit`, i.e. across the cut."""
    return "x" * (limit - 5) + TOKEN + " tail"


def assert_no_token_fragment(data):
    text = str(data)
    for i in range(len(TOKEN) - 3):
        assert TOKEN[i : i + 4] not in text, f"fragment {TOKEN[i:i + 4]!r} leaked"


async def test_anonymizer_sees_full_values_before_truncation(post):
    from agenttrace.tracking.run import ANSWER_LIMIT, LABEL_LIMIT, PAYLOAD_LIMIT, RESULT_LIMIT

    client = AsyncAgentTraceClient(url="http://localhost:3000/api/events", api_key="atr_test")
    run = AsyncAgentTraceRun(_straddle(120), client=client, anonymizer=_scrub)
    run.on_user_message(_straddle(LABEL_LIMIT) + "y" * PAYLOAD_LIMIT)  # label cut
    run.on_user_message(_straddle(PAYLOAD_LIMIT))  # payload cut
    run.on_stream_event("tool_call", "main", {"id": "1", "name": "t", "args": _straddle(60)})
    run.on_stream_event("tool_call", "main", {"id": "2", "name": "t", "args": {"q": _straddle(2000)}})
    run.on_stream_event("tool_result", "main", {"id": "1", "name": "t", "result": _straddle(RESULT_LIMIT)})
    run.on_stream_event("agent_start", "sub", {"scope": "subagent", "label": _straddle(PAYLOAD_LIMIT)})
    run.on_stream_event("final", "main", {"message": _straddle(ANSWER_LIMIT)})
    run.on_error(_straddle(PAYLOAD_LIMIT))
    await run.aclose(timeout=2.0)

    bodies = _bodies(post)
    assert len(bodies) == 9
    assert_no_token_fragment(bodies)
    assert "<id>" in bodies[0]["name"]
    events = [b for b in bodies if "type" in b]
    # Size bounds still hold after anonymization.
    assert len(events[0]["label"]) <= LABEL_LIMIT + 1
    assert len(events[1]["payload"]["message"]) <= PAYLOAD_LIMIT + 1
    assert events[2]["label"].startswith("t(") and len(events[2]["label"]) <= 60 + 4
    assert len(events[4]["payload"]["result"]) <= RESULT_LIMIT + 1
    assert len(events[6]["payload"]["answer"]) <= ANSWER_LIMIT + 1


async def test_without_anonymizer_payloads_are_still_bounded(run, post):
    from agenttrace.tracking.run import LABEL_LIMIT, PAYLOAD_LIMIT

    run.on_user_message("z" * 5000)
    run.on_stream_event("tool_call", "main", {"id": "1", "name": "t", "args": "a" * 5000})
    await run.aclose(timeout=2.0)

    events = [b for b in _bodies(post) if "type" in b]
    assert events[0]["label"] == "z" * LABEL_LIMIT + "…"
    assert events[0]["payload"]["message"] == "z" * PAYLOAD_LIMIT + "…"
    assert events[1]["label"] == "t(" + "a" * 60 + "…)"


# ----- non-JSON objects are made JSON-safe before the anonymizer runs -----


async def test_non_json_objects_are_anonymized_not_stringified_unmasked(post):
    from dataclasses import dataclass

    anonymizer = pytest.importorskip("langsmith.anonymizer")
    scrub = anonymizer.create_anonymizer([{"pattern": r"Jane Doe", "replace": "<name>"}])

    @dataclass
    class Patient:
        name: str

    client = AsyncAgentTraceClient(url="http://localhost:3000/api/events", api_key="atr_test")
    run = AsyncAgentTraceRun("test run", client=client, anonymizer=scrub)
    run.on_stream_event("approval_required", "main", {"action_requests": [Patient("Jane Doe")]})
    run.on_stream_event("tool_call", "main", {"id": "1", "name": "lookup", "args": {"who": Patient("Jane Doe")}})
    run.on_stream_event("tool_call", "main", {"id": "2", "name": "lookup", "args": Patient("Jane Doe")})
    await run.aclose(timeout=2.0)

    bodies = _bodies(post)
    assert len([b for b in bodies if "type" in b]) == 3
    assert "Jane Doe" not in str(bodies)
    assert "<name>" in str(bodies)


async def test_non_str_anonymizer_result_for_text_fails_closed(post):
    client = AsyncAgentTraceClient(url="http://localhost:3000/api/events", api_key="atr_test")
    run = AsyncAgentTraceRun(
        "Jane Doe run", client=client, anonymizer=lambda v: 42 if isinstance(v, str) else v
    )
    run.on_user_message("Jane Doe")
    await run.aclose(timeout=2.0)

    bodies = _bodies(post)
    assert bodies[0]["name"] == "[redacted]"
    assert bodies[1]["label"] == "[redacted]"


async def test_subagent_error_message_is_bounded(run, post):
    from agenttrace.tracking.run import PAYLOAD_LIMIT

    run.on_stream_event("agent_end", "sub", {"scope": "subagent", "status": "failed", "error": "e" * 5000})
    run.on_stream_event("agent_end", "sub", {"scope": "subagent", "status": "completed"})
    await run.aclose(timeout=2.0)

    events = [b for b in _bodies(post) if "type" in b]
    assert events[0]["payload"]["error"] == "e" * PAYLOAD_LIMIT + "…"
    assert events[1]["payload"]["error"] is None


# ----- keyless (`agenttrace ui --auth none`) -----


@pytest.fixture
def local_server(monkeypatch):
    """An httpx MockTransport bridging into the real FastAPI app (keyless mode)."""
    from fastapi.testclient import TestClient

    from agenttrace.server.app import app

    monkeypatch.setenv("AGENTTRACE_AUTH", "none")
    monkeypatch.setenv("AGENTTRACE_ALLOWED_HOSTS", "testserver")
    monkeypatch.setenv("AGENTTRACE_PROJECT", "async-keyless")
    monkeypatch.delenv("AGENTTRACE_KEY", raising=False)
    with TestClient(app) as test_client:
        seen = []

        def handler(request: httpx.Request) -> httpx.Response:
            seen.append(request)
            resp = test_client.post(
                request.url.path, content=request.content, headers=dict(request.headers)
            )
            return httpx.Response(resp.status_code, content=resp.content, headers=resp.headers)

        yield test_client, seen, httpx.MockTransport(handler)


async def test_keyless_run_posts_to_local_server(local_server):
    test_client, seen, transport = local_server
    async with httpx.AsyncClient(transport=transport) as http:
        client = AsyncAgentTraceClient(url="http://testserver/api/events", client=http)
        run = AsyncAgentTraceRun("keyless run", client=client)
        run.on_user_message("hi")
        run.on_stream_event("final", "main", {"message": "done"})
        run.end("completed")
        await run.aclose(timeout=5.0)

    assert all("authorization" not in r.headers for r in seen)
    created = json.loads(seen[0].content)
    assert created == {"runId": None, "name": "keyless run", "project": "async-keyless"}
    run_id = json.loads(seen[1].content)["runId"]
    stored = test_client.get(f"/api/runs/{run_id}").json()["run"]
    assert stored["status"] == "completed"
    assert [e["type"] for e in stored["events"]] == ["handoff", "final_answer"]


async def test_keyless_401_disables_run_with_one_warning(caplog, monkeypatch):
    monkeypatch.delenv("AGENTTRACE_KEY", raising=False)
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(401, json={"error": "Invalid API key"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        client = AsyncAgentTraceClient(url="http://h/api/events", client=http)
        run = AsyncAgentTraceRun("test run", client=client)
        run.on_user_message("hi")
        run.on_error("boom")
        run.end("failed")
        await run.aclose(timeout=2.0)  # never raises

    assert len(calls) == 1  # disabled after the first 401
    warnings = [r for r in caplog.records if r.levelname == "WARNING"]
    assert len(warnings) == 1 and "AGENTTRACE_KEY" in warnings[0].getMessage()
