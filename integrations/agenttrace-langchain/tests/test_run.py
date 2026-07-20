import time

import pytest

from agenttrace_langchain.client import AgentTraceClient
from agenttrace_langchain.run import AgentTraceRun, compact, truncate


def _wait_until(predicate, timeout=2.0, interval=0.01):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(interval)
    return predicate()


def test_truncate_keeps_short_text_untouched():
    assert truncate("hello", 10) == "hello"


def test_truncate_cuts_long_text_with_ellipsis():
    result = truncate("x" * 20, 5)
    assert result == "xxxxx…"


def test_compact_returns_value_unchanged_when_small():
    assert compact({"a": 1}) == {"a": 1}


def test_compact_truncates_large_payload():
    big = {"data": "x" * 5000}
    result = compact(big, limit=100)
    assert isinstance(result, str)
    assert len(result) <= 101  # limit + ellipsis char


def test_disabled_without_api_key_never_calls_network(mocker):
    post = mocker.patch("requests.post")
    client = AgentTraceClient(url="http://localhost:3000/api/events", api_key=None)

    run = AgentTraceRun("test run", client=client)
    run.emit(source="Orchestrator", target="LLM", type="llm_call")
    run.end("completed")
    run.close(timeout=2.0)

    post.assert_not_called()


def test_emits_events_in_order_via_background_worker(mocker):
    post = mocker.patch("requests.post")
    post.return_value.json.side_effect = [
        {"runId": "run_1", "event": None},
        {"runId": "run_1", "event": {}},
        {"runId": "run_1", "closed": True, "status": "completed"},
    ]
    client = AgentTraceClient(url="http://localhost:3000/api/events", api_key="atr_test")

    run = AgentTraceRun("test run", client=client)
    run.emit(source="Orchestrator", target="LLM", type="llm_call", label="step")
    run.end("completed")
    run.close(timeout=2.0)

    bodies = [call.kwargs["json"] for call in post.call_args_list]
    assert bodies[0] == {"runId": None, "name": "test run"}
    assert bodies[1]["runId"] == "run_1"
    assert bodies[1]["type"] == "llm_call"
    assert bodies[2] == {"runId": "run_1", "endRun": "completed"}


def test_network_failure_disables_run_without_raising(mocker):
    post = mocker.patch("requests.post")
    post.side_effect = ConnectionError("boom")
    client = AgentTraceClient(url="http://localhost:3000/api/events", api_key="atr_test")

    run = AgentTraceRun("test run", client=client)
    run.emit(source="Orchestrator", target="LLM", type="llm_call")  # never raises
    _wait_until(lambda: run._failed)

    # further emits are silently dropped once disabled
    run.emit(source="Orchestrator", target="LLM", type="llm_call")
    run.close(timeout=2.0)

    assert run._failed is True
