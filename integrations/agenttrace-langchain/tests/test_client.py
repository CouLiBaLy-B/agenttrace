import pytest

from agenttrace_langchain.client import VALID_EVENT_TYPES, AgentTraceClient


@pytest.fixture
def client():
    return AgentTraceClient(url="http://localhost:3000/api/events", api_key="atr_test_key")


def test_start_run_posts_null_run_id(client, mocker):
    post = mocker.patch("requests.post")
    post.return_value.json.return_value = {"runId": "run_1", "event": None}

    run_id = client.start_run("my run")

    assert run_id == "run_1"
    body = post.call_args.kwargs["json"]
    assert body == {"runId": None, "name": "my run"}
    headers = post.call_args.kwargs["headers"]
    assert headers["Authorization"] == "Bearer atr_test_key"


def test_event_rejects_invalid_type(client):
    with pytest.raises(ValueError):
        client.event("run_1", source="Orchestrator", target="LLM", type="not_a_real_type")


def test_event_sends_required_and_optional_fields(client, mocker):
    post = mocker.patch("requests.post")
    post.return_value.json.return_value = {"runId": "run_1", "event": {}}

    client.event(
        "run_1",
        source="Orchestrator",
        target="web_search",
        type="tool_call",
        label="web_search(query)",
        payload={"args": {"query": "rust web frameworks"}},
        duration_ms=720,
        status="ok",
    )

    body = post.call_args.kwargs["json"]
    assert body == {
        "runId": "run_1",
        "source": "Orchestrator",
        "target": "web_search",
        "type": "tool_call",
        "label": "web_search(query)",
        "payload": {"args": {"query": "rust web frameworks"}},
        "durationMs": 720,
        "status": "ok",
    }


def test_end_run_defaults_to_completed(client, mocker):
    post = mocker.patch("requests.post")
    post.return_value.json.return_value = {"runId": "run_1", "closed": True, "status": "completed"}

    client.end_run("run_1")

    assert post.call_args.kwargs["json"] == {"runId": "run_1", "endRun": "completed"}


def test_emit_without_api_key_raises():
    client = AgentTraceClient(url="http://localhost:3000/api/events", api_key=None)
    with pytest.raises(RuntimeError):
        client.emit({"runId": None, "name": "x"})


def test_valid_event_types_match_prisma_contract():
    assert VALID_EVENT_TYPES == {
        "llm_call",
        "tool_call",
        "tool_result",
        "handoff",
        "error",
        "final_answer",
    }
