import pytest

from agenttrace_langchain.middleware import AgentTraceMiddleware


class FakeToolRequest:
    def __init__(self, name, args):
        self.tool_call = {"name": name, "args": args}


class FakeModelRequest:
    def __init__(self, model_name):
        self.model = type("Model", (), {"model": model_name})()


class FakeToolMessage:
    def __init__(self, content):
        self.content = content


class FakeModelResponse:
    """Mirrors langchain.agents.middleware.types.ModelResponse: what a real
    wrap_model_call handler actually returns (`.result: list[BaseMessage]`),
    not a bare message. A middleware that reads `.content` off this directly
    (instead of unwrapping `.result[-1]`) silently captures the wrong thing —
    see AgentTraceMiddleware._emit_llm_call / _last_model_message."""

    def __init__(self, messages):
        self.result = messages


@pytest.fixture
def post(mocker):
    post = mocker.patch("requests.post")
    post.return_value.json.return_value = {"runId": "run_1", "event": {}}
    return post


@pytest.fixture
def middleware():
    return AgentTraceMiddleware(
        run_name="test run", url="http://localhost:3000/api/events", api_key="atr_test", timeout=2.0
    )


def _bodies(post):
    return [call.kwargs["json"] for call in post.call_args_list]


def test_before_agent_creates_the_run_object_without_a_network_call_yet(middleware, post):
    middleware.before_agent({"messages": []}, runtime=None)
    middleware._run.close(timeout=2.0)

    # The AgentTraceRun exists, but the remote run itself is only created lazily
    # on the first real event — before_agent alone shouldn't hit the network.
    assert middleware._run is not None
    post.assert_not_called()


def test_first_emitted_event_creates_the_remote_run(middleware, post):
    middleware.before_agent({"messages": []}, runtime=None)
    middleware.wrap_tool_call(FakeToolRequest("noop", {}), lambda req: FakeToolMessage("ok"))
    middleware._run.close(timeout=2.0)

    assert _bodies(post)[0] == {"runId": None, "name": "test run"}


def test_wrap_tool_call_emits_call_then_result(middleware, post):
    request = FakeToolRequest("web_search", {"query": "rust"})
    handler = lambda req: FakeToolMessage("some result")

    result = middleware.wrap_tool_call(request, handler)

    middleware._run.close(timeout=2.0)
    bodies = _bodies(post)
    events = [b for b in bodies if b.get("runId") == "run_1" and "type" in b]
    assert events[0]["type"] == "tool_call"
    assert events[0]["target"] == "web_search"
    assert events[1]["type"] == "tool_result"
    assert events[1]["source"] == "web_search"
    assert result.content == "some result"


def test_wrap_tool_call_emits_error_and_reraises(middleware, post):
    request = FakeToolRequest("flaky_tool", {})

    def handler(req):
        raise ValueError("boom")

    with pytest.raises(ValueError):
        middleware.wrap_tool_call(request, handler)

    middleware._run.close(timeout=2.0)
    bodies = _bodies(post)
    events = [b for b in bodies if b.get("runId") == "run_1" and "type" in b]
    assert events[-1]["type"] == "error"
    assert events[-1]["payload"]["error"] == "ValueError"
    assert middleware._had_error is True


def test_wrap_tool_call_detects_handoff(middleware, post):
    request = FakeToolRequest("handoff_to_researcher", {"to": "Researcher"})
    handler = lambda req: FakeToolMessage("ok")

    middleware.wrap_tool_call(request, handler)

    middleware._run.close(timeout=2.0)
    events = [b for b in _bodies(post) if b.get("runId") == "run_1" and "type" in b]
    handoff = next(e for e in events if e["type"] == "handoff")
    assert handoff["target"] == "Researcher"


def test_wrap_model_call_emits_llm_call(middleware, post):
    request = FakeModelRequest("gpt-4o-mini")
    handler = lambda req: FakeToolMessage("answer")

    middleware.wrap_model_call(request, handler)

    middleware._run.close(timeout=2.0)
    events = [b for b in _bodies(post) if b.get("runId") == "run_1" and "type" in b]
    assert events[0]["type"] == "llm_call"
    assert events[0]["target"] == "gpt-4o-mini"


def test_wrap_model_call_unwraps_real_model_response(middleware, post):
    """Regression test: a real langchain wrap_model_call handler returns a
    ModelResponse (`.result: list[BaseMessage]`), not a bare message — verified
    against an actual deepagents graph while writing the examples/ folder."""
    request = FakeModelRequest("gpt-4o-mini")
    handler = lambda req: FakeModelResponse([FakeToolMessage("first"), FakeToolMessage("final answer text")])

    middleware.wrap_model_call(request, handler)

    middleware._run.close(timeout=2.0)
    events = [b for b in _bodies(post) if b.get("runId") == "run_1" and "type" in b]
    assert events[0]["payload"]["output_preview"] == "final answer text"


def test_after_agent_emits_final_answer_and_closes_run(middleware, post):
    middleware.before_agent({"messages": []}, runtime=None)
    state = {"messages": [FakeToolMessage("the final answer")]}

    middleware.after_agent(state, runtime=None)

    bodies = _bodies(post)
    events = [b for b in bodies if b.get("runId") == "run_1" and "type" in b]
    assert events[-1]["type"] == "final_answer"
    assert events[-1]["payload"]["answer"] == "the final answer"
    assert bodies[-1] == {"runId": "run_1", "endRun": "completed"}


def test_after_agent_marks_run_failed_when_a_tool_errored(middleware, post):
    request = FakeToolRequest("flaky_tool", {})
    with pytest.raises(ValueError):
        middleware.wrap_tool_call(request, lambda req: (_ for _ in ()).throw(ValueError("boom")))

    middleware.after_agent({"messages": []}, runtime=None)

    assert _bodies(post)[-1] == {"runId": "run_1", "endRun": "failed"}


@pytest.mark.asyncio
async def test_async_wrap_tool_call_and_model_call(middleware, post):
    async def tool_handler(req):
        return FakeToolMessage("async result")

    async def model_handler(req):
        return FakeToolMessage("async answer")

    await middleware.awrap_tool_call(FakeToolRequest("web_search", {}), tool_handler)
    await middleware.awrap_model_call(FakeModelRequest("gpt-4o-mini"), model_handler)

    middleware._run.close(timeout=2.0)
    events = [b for b in _bodies(post) if b.get("runId") == "run_1" and "type" in b]
    types = [e["type"] for e in events]
    assert types == ["tool_call", "tool_result", "llm_call"]
