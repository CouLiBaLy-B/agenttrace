import uuid

import pytest

from agenttrace_langchain.async_client import AsyncAgentTraceClient
from agenttrace_langchain.callback import AgentTraceCallbackHandler


class FakeMessage:
    def __init__(self, role, content):
        self.type = role
        self.content = content


class FakeAIMessage:
    def __init__(self, content, usage=None):
        self.type = "ai"
        self.content = content
        self.usage_metadata = usage


class FakeGeneration:
    def __init__(self, message):
        self.message = message
        self.text = getattr(message, "content", "")


class FakeLLMResult:
    """Mirrors langchain_core.outputs.LLMResult: `.generations[0][0].message`
    is the AIMessage, `.llm_output` the provider blob."""

    def __init__(self, message, llm_output=None):
        self.generations = [[FakeGeneration(message)]]
        self.llm_output = llm_output


@pytest.fixture
def post(mocker):
    post = mocker.patch("httpx.AsyncClient.post")
    response = mocker.Mock()
    response.raise_for_status.return_value = None
    response.json.return_value = {"runId": "run_1", "event": {}}
    post.return_value = response
    return post


@pytest.fixture
async def handler(post):
    client = AsyncAgentTraceClient(url="http://localhost:3000/api/events", api_key="atr_test")
    return AgentTraceCallbackHandler("test run", client=client)


def _bodies(post):
    return [call.kwargs["json"] for call in post.call_args_list]


def _events(post):
    return [b for b in _bodies(post) if "type" in b]


async def test_llm_call_captures_input_output_and_tokens(handler, post):
    rid = uuid.uuid4()
    await handler.on_chat_model_start(
        {"name": "gpt-4o-mini"},
        [[FakeMessage("system", "You are helpful."), FakeMessage("human", "Hi?")]],
        run_id=rid,
        metadata={"ls_model_name": "gpt-4o-mini"},
    )
    await handler.on_llm_end(
        FakeLLMResult(FakeAIMessage("Hello!", {"input_tokens": 5, "output_tokens": 3})),
        run_id=rid,
    )
    await handler.aclose()

    ev = _events(post)[0]
    assert ev["type"] == "llm_call"
    assert ev["target"] == "gpt-4o-mini"
    assert ev["payload"]["input"]["system"] == "You are helpful."
    assert ev["payload"]["input"]["messages"] == [{"role": "human", "content": "Hi?"}]
    assert ev["payload"]["output_preview"] == "Hello!"
    assert ev["payload"]["tokens"] == {"input_tokens": 5, "output_tokens": 3}


async def test_model_label_is_stable_across_calls(handler, post):
    """One model → one LLM lane: a later call whose metadata omits the model
    name reuses the name remembered from the first call (no second lane)."""
    r1, r2 = uuid.uuid4(), uuid.uuid4()
    await handler.on_chat_model_start(
        {}, [[FakeMessage("human", "a")]], run_id=r1, metadata={"ls_model_name": "zai.glm-5"}
    )
    await handler.on_llm_end(FakeLLMResult(FakeAIMessage("x")), run_id=r1)
    # Second call: no ls_model_name in metadata, no usable serialized model.
    await handler.on_chat_model_start({}, [[FakeMessage("human", "b")]], run_id=r2, metadata={})
    await handler.on_llm_end(FakeLLMResult(FakeAIMessage("y")), run_id=r2)
    await handler.aclose()

    targets = [e["target"] for e in _events(post) if e["type"] == "llm_call"]
    assert targets == ["zai.glm-5", "zai.glm-5"]


async def test_tool_call_and_result_pair_with_duration(handler, post):
    rid = uuid.uuid4()
    await handler.on_tool_start({"name": "web_search"}, "q", run_id=rid, inputs={"query": "rust"})
    await handler.on_tool_end("some result", run_id=rid)
    await handler.aclose()

    events = _events(post)
    assert events[0]["type"] == "tool_call"
    assert events[0]["target"] == "web_search"
    assert events[1]["type"] == "tool_result"
    assert events[1]["source"] == "web_search"
    assert "durationMs" in events[1]


async def test_task_tool_emits_handoff_not_tool_call(handler, post):
    rid = uuid.uuid4()
    await handler.on_tool_start(
        {"name": "task"}, "", run_id=rid, inputs={"subagent_type": "researcher", "description": "dig"}
    )
    await handler.on_tool_end("done", run_id=rid)
    await handler.aclose()

    events = _events(post)
    assert events[0]["type"] == "handoff"
    assert events[0]["target"] == "researcher"
    assert events[1]["type"] == "tool_result"  # subagent done
    assert events[1]["source"] == "researcher"


async def test_subagent_attribution_from_metadata(handler, post):
    """An LLM call inside a sub-agent node is attributed to that node, not the
    orchestrator — via metadata['langgraph_node'] (same signal astream_events
    exposes)."""
    rid = uuid.uuid4()
    await handler.on_chat_model_start(
        {}, [[FakeMessage("human", "x")]], run_id=rid, metadata={"langgraph_node": "prerequisites-agent"}
    )
    await handler.on_llm_end(FakeLLMResult(FakeAIMessage("y")), run_id=rid)
    await handler.aclose()

    assert _events(post)[0]["source"] == "prerequisites-agent"


async def test_structural_model_node_attributes_to_orchestrator(handler, post):
    """A main-agent LLM call runs under the structural langgraph node "model"
    (langchain/deepagents name it that) — it must attribute to the orchestrator,
    NOT a phantom "model" participant."""
    rid = uuid.uuid4()
    await handler.on_chat_model_start(
        {}, [[FakeMessage("human", "x")]], run_id=rid,
        metadata={"ls_model_name": "gpt", "langgraph_node": "model", "checkpoint_ns": "model:abc"},
    )
    await handler.on_llm_end(FakeLLMResult(FakeAIMessage("y")), run_id=rid)
    await handler.aclose()

    assert _events(post)[0]["source"] == "Orchestrator"


async def test_subagent_inner_calls_attributed_via_task_ns(handler, post):
    """After a `task` delegation, an inner call sharing that task's
    checkpoint_ns attributes to the sub-agent, not the orchestrator — even
    though its langgraph_node is the structural "model"."""
    task_rid, llm_rid = uuid.uuid4(), uuid.uuid4()
    await handler.on_tool_start(
        {"name": "task"}, "", run_id=task_rid,
        metadata={"checkpoint_ns": "tools:xyz"},
        inputs={"subagent_type": "researcher", "description": "dig"},
    )
    await handler.on_chat_model_start(
        {}, [[FakeMessage("human", "x")]], run_id=llm_rid,
        metadata={"ls_model_name": "gpt", "langgraph_node": "model", "checkpoint_ns": "tools:xyz"},
    )
    await handler.on_llm_end(FakeLLMResult(FakeAIMessage("y")), run_id=llm_rid)
    await handler.on_tool_end("done", run_id=task_rid)
    await handler.aclose()

    inner = next(e for e in _events(post) if e["type"] == "llm_call")
    assert inner["source"] == "researcher"


async def test_anonymizer_applied_to_every_payload(post):
    client = AsyncAgentTraceClient(url="http://localhost:3000/api/events", api_key="atr_test")
    h = AgentTraceCallbackHandler("run", client=client, anonymizer=lambda p: {"masked": True})
    rid = uuid.uuid4()
    await h.on_tool_start({"name": "lookup"}, "", run_id=rid, inputs={"patient": "Jane Doe"})
    await h.on_tool_end("SSN 123", run_id=rid)
    await h.aclose()

    for ev in _events(post):
        assert ev["payload"] == {"masked": True}


async def test_tool_error_emits_error_event(handler, post):
    rid = uuid.uuid4()
    await handler.on_tool_start({"name": "flaky"}, "", run_id=rid, inputs={})
    await handler.on_tool_error(ValueError("boom"), run_id=rid)
    await handler.aclose()

    err = next(e for e in _events(post) if e["type"] == "error")
    assert err["payload"]["error"] == "ValueError"
    assert err["status"] == "error"


async def test_finish_emits_final_answer_and_ends(handler, post):
    await handler.finish("completed", answer="the report")
    await handler.aclose()

    bodies = _bodies(post)
    events = _events(post)
    assert events[-1]["type"] == "final_answer"
    assert events[-1]["payload"]["answer"] == "the report"
    assert bodies[-1] == {"runId": "run_1", "endRun": "completed"}


async def test_approval_required_emits_pending_handoff(handler, post):
    handler.approval_required({"tool": "delete_all"})
    await handler.aclose()

    approval = next(e for e in _events(post) if e.get("status") == "pending")
    assert approval["type"] == "handoff"
    assert approval["target"] == "User"


async def test_never_fatal_without_api_key(post):
    client = AsyncAgentTraceClient(url="http://localhost:3000/api/events", api_key=None)
    h = AgentTraceCallbackHandler("run", client=client)
    rid = uuid.uuid4()
    h.on_user_message("hi")
    await h.on_tool_start({"name": "t"}, "", run_id=rid, inputs={})
    await h.on_tool_end("ok", run_id=rid)
    await h.aclose()  # never raises

    post.assert_not_called()
