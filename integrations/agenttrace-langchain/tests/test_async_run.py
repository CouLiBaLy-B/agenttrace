import pytest

from agenttrace_langchain.async_client import AsyncAgentTraceClient
from agenttrace_langchain.async_run import AsyncAgentTraceRun


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


async def test_tool_server_callback_enriches_payload(post):
    client = AsyncAgentTraceClient(url="http://localhost:3000/api/events", api_key="atr_test")
    run = AsyncAgentTraceRun("test run", client=client, tool_server=lambda name: "iam-mcp")
    run.on_stream_event("tool_call", "main", {"id": "1", "name": "iam_list_users", "args": {}})
    await run.aclose(timeout=2.0)

    events = [b for b in _bodies(post) if "type" in b]
    assert events[0]["payload"]["server"] == "iam-mcp"


async def test_on_error_and_never_fatal_without_api_key(post):
    client = AsyncAgentTraceClient(url="http://localhost:3000/api/events", api_key=None)
    run = AsyncAgentTraceRun("test run", client=client)

    run.on_user_message("hi")
    run.on_error("boom")
    run.end("failed")
    await run.aclose(timeout=2.0)  # never raises

    post.assert_not_called()
