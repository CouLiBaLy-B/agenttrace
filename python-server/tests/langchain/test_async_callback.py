import uuid

import pytest

import agenttrace
from agenttrace.langchain import AsyncAgentTraceCallbackHandler
from agenttrace.tracking.async_http import AsyncHttpEventClient as AsyncAgentTraceClient


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
    return AsyncAgentTraceCallbackHandler("test run", client=client)


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


async def test_tool_result_payload_is_the_tool_messages_content(handler, post):
    from langchain_core.messages import ToolMessage

    for content in ("Order #4521 shipped", [{"type": "text", "text": "Order #4521 "}, {"type": "text", "text": "shipped"}]):
        rid = uuid.uuid4()
        await handler.on_tool_start({"name": "find_order"}, "", run_id=rid, inputs={"email": "x"})
        await handler.on_tool_end(ToolMessage(content=content, name="find_order", tool_call_id="call_2"), run_id=rid)
    await handler.aclose()

    results = [e["payload"]["result"] for e in _events(post) if e["type"] == "tool_result"]
    assert results == ["Order #4521 shipped", "Order #4521 shipped"]


async def test_tool_result_anonymized_before_truncation(post):
    from langchain_core.messages import ToolMessage

    from agenttrace.tracking.run import RESULT_LIMIT

    def scrub(value):  # payloads arrive as dicts, labels and the run name as strings
        if isinstance(value, dict):
            return {key: scrub(item) for key, item in value.items()}
        return value.replace("jane@x.com", "<email>") if isinstance(value, str) else value

    client = AsyncAgentTraceClient(url="http://localhost:3000/api/events", api_key="atr_test")
    handler = AsyncAgentTraceCallbackHandler("run", client=client, anonymizer=scrub)
    # The address straddles the truncation limit: truncating first would leak "jane@x".
    content = "x" * (RESULT_LIMIT - 6) + " jane@x.com and more"
    rid = uuid.uuid4()
    await handler.on_tool_start({"name": "lookup"}, "", run_id=rid, inputs={})
    await handler.on_tool_end(ToolMessage(content=content, tool_call_id="c"), run_id=rid)
    await handler.aclose()

    result = next(e for e in _events(post) if e["type"] == "tool_result")["payload"]["result"]
    assert "jane" not in result
    assert result.startswith("x" * (RESULT_LIMIT - 6) + " <emai")


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
    h = AsyncAgentTraceCallbackHandler(
        "run", client=client, anonymizer=lambda v: "<masked>" if isinstance(v, str) else {"masked": True}
    )
    rid, task_rid = uuid.uuid4(), uuid.uuid4()
    await h.on_tool_start({"name": "lookup"}, "", run_id=rid, inputs={"patient": "Jane Doe"})
    await h.on_tool_end("SSN 123", run_id=rid)
    await h.on_tool_start(
        {"name": "task"}, "", run_id=task_rid, inputs={"subagent_type": "researcher", "description": "Jane Doe"}
    )
    await h.on_tool_error(ValueError("Jane Doe not found"), run_id=task_rid)
    await h.aclose()

    events = _events(post)
    assert len(events) == 4
    for ev in events:
        assert ev["payload"] == {"masked": True}
        assert ev["label"] == "<masked>"
    assert "Jane Doe" not in str(_bodies(post))


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


async def test_keyless_client_posts_without_auth_header(post, monkeypatch):
    """No API key: events still go out (local `agenttrace ui --auth none`),
    without an Authorization header and with the project named."""
    monkeypatch.delenv("AGENTTRACE_KEY", raising=False)
    client = AsyncAgentTraceClient(url="http://localhost:3000/api/events")
    h = AsyncAgentTraceCallbackHandler("run", client=client)
    h.on_user_message("hi")
    await h.finish("completed", answer="ok")
    await h.aclose()

    assert post.call_count == 4  # create, user message, final answer, end
    assert all("Authorization" not in c.kwargs["headers"] for c in post.call_args_list)
    assert "project" in _bodies(post)[0]


async def test_never_fatal_when_the_server_fails(post):
    post.side_effect = RuntimeError("connection refused")
    client = AsyncAgentTraceClient(url="http://localhost:3000/api/events", api_key="atr_test")
    h = AsyncAgentTraceCallbackHandler("run", client=client)
    rid = uuid.uuid4()
    h.on_user_message("hi")
    await h.on_tool_start({"name": "t"}, "", run_id=rid, inputs={})
    await h.on_tool_end("ok", run_id=rid)
    await h.aclose()  # never raises

    assert post.call_count == 1  # disabled after the first failure


# ----- client is optional: built from the tracking URI -----


@pytest.fixture
def tracking_uri(monkeypatch):
    for var in ("AGENTTRACE_TRACKING_URI", "AGENTTRACE_URL", "AGENTTRACE_KEY"):
        monkeypatch.delenv(var, raising=False)
    yield agenttrace.set_tracking_uri
    agenttrace.set_tracking_uri(None)


async def test_client_defaults_to_tracking_uri_events_url(tracking_uri, monkeypatch):
    tracking_uri("http://traces.local:4000")
    monkeypatch.setenv("AGENTTRACE_KEY", "atr_env")
    h = AsyncAgentTraceCallbackHandler("run")
    client = h.run._client
    assert isinstance(client, AsyncAgentTraceClient)
    assert client.url == "http://traces.local:4000/api/events"
    assert client.api_key == "atr_env"
    await h.aclose()


async def test_client_required_for_non_http_tracking_uri(tracking_uri, tmp_path):
    tracking_uri(f"sqlite:///{tmp_path}/agenttrace.db")
    with pytest.raises(ValueError, match="AGENTTRACE_TRACKING_URI=http://host:port"):
        AsyncAgentTraceCallbackHandler("run")


async def test_llm_input_and_output_anonymized_before_truncation(post):
    from agenttrace.langchain.projection import SYSTEM_LIMIT
    from agenttrace.tracking.run import RESULT_LIMIT
    from tests.tracking.test_async_run import _scrub, _straddle, assert_no_token_fragment

    client = AsyncAgentTraceClient(url="http://localhost:3000/api/events", api_key="atr_test")
    h = AsyncAgentTraceCallbackHandler("run", client=client, anonymizer=_scrub)
    chat, text, tool = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    await h.on_chat_model_start(
        {},
        [[FakeMessage("system", _straddle(SYSTEM_LIMIT)), FakeMessage("human", _straddle(RESULT_LIMIT))]],
        run_id=chat,
        metadata={"ls_model_name": "gpt"},
    )
    await h.on_llm_end(FakeLLMResult(FakeAIMessage(_straddle(240))), run_id=chat)
    await h.on_llm_start({}, [_straddle(RESULT_LIMIT)], run_id=text)
    await h.on_llm_end(FakeLLMResult(FakeAIMessage("ok")), run_id=text)
    await h.on_tool_start({"name": "lookup"}, "", run_id=tool, inputs={"q": _straddle(60)})
    await h.on_tool_end(_straddle(RESULT_LIMIT), run_id=tool)
    await h.finish("completed", answer=_straddle(500))
    await h.aclose()

    assert_no_token_fragment(_bodies(post))
    llm = [e for e in _events(post) if e["type"] == "llm_call"]
    assert len(llm[0]["payload"]["input"]["system"]) <= SYSTEM_LIMIT + 1
    assert len(llm[0]["payload"]["input"]["messages"][0]["content"]) <= RESULT_LIMIT + 1
    assert len(llm[0]["payload"]["output_preview"]) <= 241
    assert len(llm[1]["payload"]["input"]["prompts"][0]) <= RESULT_LIMIT + 1


async def test_only_exact_task_tool_is_a_handoff(handler, post):
    plain, task = uuid.uuid4(), uuid.uuid4()
    await handler.on_tool_start({"name": "create_task"}, "", run_id=plain, inputs={"name": "Call Jane Doe"})
    await handler.on_tool_end("created", run_id=plain)
    await handler.on_tool_start({"name": "task"}, "", run_id=task, inputs={"subagent_type": "regression-agent"})
    await handler.on_tool_end("done", run_id=task)
    await handler.aclose()

    events = _events(post)
    assert [(e["type"], e["target"]) for e in events[:2]] == [("tool_call", "create_task"), ("tool_result", "Orchestrator")]
    assert events[2]["type"] == "handoff" and events[2]["target"] == "regression-agent"
    assert events[3]["source"] == "regression-agent"


async def test_handoff_target_is_anonymized_and_capped(post):
    client = AsyncAgentTraceClient(url="http://localhost:3000/api/events", api_key="atr_test")
    def scrub(v):
        if isinstance(v, str):
            return v.replace("Jane Doe", "<name>")
        if isinstance(v, dict):
            return {k: scrub(x) for k, x in v.items()}
        return v

    h = AsyncAgentTraceCallbackHandler("run", client=client, anonymizer=scrub)
    pii, long_name = uuid.uuid4(), uuid.uuid4()
    await h.on_tool_start({"name": "handoff_to"}, "", run_id=pii, inputs={"to": "Jane Doe"})
    await h.on_tool_end("ok", run_id=pii)
    await h.on_tool_start({"name": "task"}, "", run_id=long_name, inputs={"subagent_type": "a" * 200})
    await h.on_tool_end("ok", run_id=long_name)
    await h.aclose()

    handoffs = [e for e in _events(post) if e["type"] == "handoff"]
    assert handoffs[0]["target"] == "Sub-agent"
    assert handoffs[1]["target"] == "a" * 60
    assert "Jane Doe" not in str(_bodies(post))


async def test_handoff_target_falls_back_when_anonymizer_fails(post):
    def broken(value):
        raise RuntimeError("down")

    client = AsyncAgentTraceClient(url="http://localhost:3000/api/events", api_key="atr_test")
    h = AsyncAgentTraceCallbackHandler("run", client=client, anonymizer=broken)
    rid = uuid.uuid4()
    await h.on_tool_start({"name": "task"}, "", run_id=rid, inputs={"subagent_type": "researcher"})
    await h.aclose()

    assert _events(post)[0]["target"] == "Sub-agent"


async def test_error_messages_are_bounded(handler, post):
    from agenttrace.tracking.run import PAYLOAD_LIMIT

    llm, tool = uuid.uuid4(), uuid.uuid4()
    await handler.on_chat_model_start({}, [[FakeMessage("human", "x")]], run_id=llm)
    await handler.on_llm_error(ValueError("m" * 5000), run_id=llm)
    await handler.on_tool_start({"name": "flaky"}, "", run_id=tool, inputs={})
    await handler.on_tool_error(ValueError("t" * 5000), run_id=tool)
    await handler.aclose()

    errors = [e for e in _events(post) if e["type"] == "error"]
    assert [len(e["payload"]["message"]) for e in errors] == [PAYLOAD_LIMIT + 1, PAYLOAD_LIMIT + 1]


async def test_subagent_attribution_prefers_the_per_task_namespace(handler, post):
    """`checkpoint_ns` can be stale (some langgraph releases keep the first
    request's value in a cached sub-agent's config); the per-task
    `langgraph_checkpoint_ns` decides."""
    task_rid, llm_rid = uuid.uuid4(), uuid.uuid4()
    await handler.on_tool_start(
        {"name": "task"}, "", run_id=task_rid,
        metadata={"checkpoint_ns": "tools:new", "langgraph_checkpoint_ns": "tools:new"},
        inputs={"subagent_type": "researcher", "description": "dig"},
    )
    await handler.on_chat_model_start(
        {}, [[FakeMessage("human", "x")]], run_id=llm_rid,
        metadata={"langgraph_node": "model", "checkpoint_ns": "tools:old", "langgraph_checkpoint_ns": "tools:new|model:1"},
    )
    await handler.on_llm_end(FakeLLMResult(FakeAIMessage("y")), run_id=llm_rid)
    await handler.on_tool_end("done", run_id=task_rid)
    await handler.aclose()

    inner = next(e for e in _events(post) if e["type"] == "llm_call")
    assert inner["source"] == "researcher"


async def test_nested_subagent_calls_go_to_the_innermost_subagent(handler, post):
    outer, inner, llm_rid = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    await handler.on_tool_start(
        {"name": "task"}, "", run_id=outer, metadata={"langgraph_checkpoint_ns": "tools:a"},
        inputs={"subagent_type": "researcher", "description": "dig"},
    )
    await handler.on_tool_start(
        {"name": "task"}, "", run_id=inner, metadata={"langgraph_checkpoint_ns": "tools:a|tools:b"},
        inputs={"subagent_type": "fact-checker", "description": "check"},
    )
    await handler.on_chat_model_start(
        {}, [[FakeMessage("human", "x")]], run_id=llm_rid,
        metadata={"langgraph_node": "model", "langgraph_checkpoint_ns": "tools:a|tools:b|model:c"},
    )
    await handler.on_llm_end(FakeLLMResult(FakeAIMessage("y")), run_id=llm_rid)
    await handler.aclose()

    assert next(e for e in _events(post) if e["type"] == "llm_call")["source"] == "fact-checker"


async def test_subagent_attribution_survives_a_cached_agent(post):
    """A server reuses one compiled agent (and its compiled sub-agent) across
    requests: the sub-agent's calls stay on its lane on every request, not
    only the first."""
    from langchain.agents import create_agent
    from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel
    from langchain_core.messages import AIMessage
    from langchain_core.tools import tool

    class ScriptedModel(FakeMessagesListChatModel):
        def bind_tools(self, tools, **kwargs):
            return self

    @tool
    def lookup(query: str) -> str:
        """Look something up."""
        return "found"

    researcher = create_agent(
        ScriptedModel(responses=[
            AIMessage(content="", tool_calls=[{"name": "lookup", "args": {"query": "x"}, "id": "call_2"}]),
            AIMessage(content="sub-agent answer"),
        ]),
        tools=[lookup],
        name="researcher",
    )

    @tool
    async def task(description: str, subagent_type: str) -> str:
        """Hand a task to a sub-agent."""
        result = await researcher.ainvoke({"messages": [{"role": "user", "content": description}]})
        return result["messages"][-1].content

    agent = create_agent(
        ScriptedModel(responses=[
            AIMessage(content="", tool_calls=[
                {"name": "task", "args": {"description": "dig", "subagent_type": "researcher"}, "id": "call_1"}
            ]),
            AIMessage(content="answer"),
        ]),
        tools=[task],
    )

    for _ in range(2):
        post.reset_mock()
        handler = AsyncAgentTraceCallbackHandler(
            "run", client=AsyncAgentTraceClient(url="http://localhost:3000/api/events", api_key="atr_test")
        )
        await agent.ainvoke({"messages": [{"role": "user", "content": "q"}]}, config={"callbacks": [handler]})
        await handler.aclose()
        assert [(e["type"], e["source"]) for e in _events(post)] == [
            ("llm_call", "Orchestrator"),
            ("handoff", "Orchestrator"),
            ("llm_call", "researcher"),
            ("tool_call", "researcher"),
            ("tool_result", "lookup"),
            ("llm_call", "researcher"),
            ("tool_result", "researcher"),
            ("llm_call", "Orchestrator"),
        ]
