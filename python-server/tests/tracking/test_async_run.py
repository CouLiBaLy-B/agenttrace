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


async def test_anonymizer_applied_to_every_payload(post):
    client = AsyncAgentTraceClient(url="http://localhost:3000/api/events", api_key="atr_test")
    run = AsyncAgentTraceRun("test run", client=client, anonymizer=lambda p: {"masked": True})
    run.on_user_message("Jane Doe, SSN 123")
    run.on_stream_event("final", "main", {"message": "Jane Doe is fine"})
    await run.aclose(timeout=2.0)

    events = [b for b in _bodies(post) if "type" in b]
    assert len(events) == 2
    assert all(e["payload"] == {"masked": True} for e in events)


async def test_failing_anonymizer_is_never_fatal(post, caplog):
    def broken(payload):
        raise RuntimeError("scrubber down")

    client = AsyncAgentTraceClient(url="http://localhost:3000/api/events", api_key="atr_test")
    run = AsyncAgentTraceRun("test run", client=client, anonymizer=broken)
    run.on_user_message("hello")
    await run.aclose(timeout=2.0)

    events = [b for b in _bodies(post) if "type" in b]
    assert events[0]["payload"] == {"message": "hello"}  # passed through unmasked
    assert any("anonymizer raised" in r.getMessage() for r in caplog.records)


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
