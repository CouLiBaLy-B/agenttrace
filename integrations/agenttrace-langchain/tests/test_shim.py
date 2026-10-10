import importlib
import sys
import warnings

import pytest


def _fresh(name):
    for mod in [m for m in sys.modules if m == "agenttrace_langchain" or m.startswith("agenttrace_langchain.")]:
        sys.modules.pop(mod)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        return importlib.import_module(name)


def test_shim_reexports_and_warns():
    sys.modules.pop("agenttrace_langchain", None)
    with pytest.warns(DeprecationWarning, match="agenttrace.langchain"):
        shim = importlib.import_module("agenttrace_langchain")
    from agenttrace.langchain import AgentTraceCallbackHandler as SyncHandler
    from agenttrace.langchain.async_callback import AsyncAgentTraceCallbackHandler
    from agenttrace.langchain.middleware import AgentTraceMiddleware
    from agenttrace.tracking.async_http import AsyncHttpEventClient
    from agenttrace.tracking.async_run import AsyncAgentTraceRun
    from agenttrace.tracking.http import AgentTraceRun, HttpEventClient

    assert shim.AgentTraceMiddleware is AgentTraceMiddleware
    assert shim.AgentTraceClient is HttpEventClient
    assert shim.AgentTraceRun is AgentTraceRun
    assert shim.AsyncAgentTraceClient is AsyncHttpEventClient
    assert shim.AsyncAgentTraceRun is AsyncAgentTraceRun
    # 0.2.2 name/semantics: the async per-request handler, not the sync autolog one.
    assert shim.AgentTraceCallbackHandler is AsyncAgentTraceCallbackHandler
    assert shim.AgentTraceCallbackHandler is not SyncHandler
    assert "AgentTraceCallbackHandler" in shim.__all__


def test_pre_0_2_submodules_still_import():
    from agenttrace.langchain import middleware as new_middleware
    from agenttrace.tracking import async_http, async_run, http, run

    client = _fresh("agenttrace_langchain.client")
    assert client.AgentTraceClient is http.HttpEventClient
    assert client.DEFAULT_URL == http.DEFAULT_URL
    assert client.VALID_EVENT_TYPES is http.VALID_EVENT_TYPES

    assert _fresh("agenttrace_langchain.async_client").AsyncAgentTraceClient is async_http.AsyncHttpEventClient

    old_run = _fresh("agenttrace_langchain.run")
    assert old_run.AgentTraceRun is http.AgentTraceRun
    for name in ("truncate", "compact", "LABEL_LIMIT", "PAYLOAD_LIMIT", "RESULT_LIMIT", "ANSWER_LIMIT"):
        assert getattr(old_run, name) is getattr(run, name)

    assert _fresh("agenttrace_langchain.async_run").AsyncAgentTraceRun is async_run.AsyncAgentTraceRun
    assert _fresh("agenttrace_langchain.middleware").AgentTraceMiddleware is new_middleware.AgentTraceMiddleware


def test_0_2_2_submodules_still_import():
    from agenttrace.langchain import projection
    from agenttrace.langchain.async_callback import AsyncAgentTraceCallbackHandler

    assert _fresh("agenttrace_langchain.callback").AgentTraceCallbackHandler is AsyncAgentTraceCallbackHandler
    old_projection = _fresh("agenttrace_langchain.projection")
    for name in old_projection.__all__:
        assert getattr(old_projection, name) is getattr(projection, name)


async def test_0_2_2_usage_still_works(mocker):
    """The downstream 0.2.2 call pattern: explicit AsyncAgentTraceClient,
    phrases + anonymizer, user message, HITL pause, finish, aclose."""
    post = mocker.patch("httpx.AsyncClient.post")
    response = mocker.Mock()
    response.json.return_value = {"runId": "run_1"}
    post.return_value = response
    shim = _fresh("agenttrace_langchain")

    client = shim.AsyncAgentTraceClient(url="http://localhost:3000/api/events", api_key="atr_test")
    handler = shim.AgentTraceCallbackHandler(
        "session-1", client=client, phrases={"final_answer": "réponse"}, anonymizer=lambda v: v
    )
    handler.on_user_message("query")
    handler.approval_required({"tool": "x"})
    await handler.finish("completed", answer="report")
    await handler.aclose()

    bodies = [c.kwargs["json"] for c in post.call_args_list]
    assert [b.get("type") for b in bodies[1:-1]] == ["handoff", "handoff", "final_answer"]
    assert bodies[-2]["label"] == "réponse"
    assert bodies[-1] == {"runId": "run_1", "endRun": "completed"}


async def test_0_2_2_keyless_with_injected_httpx_client_and_masking(monkeypatch):
    """0.2.2 pattern with api_key=None and the app's own httpx.AsyncClient:
    posts keylessly (no Authorization header) and masks every payload/label."""
    import json

    import httpx

    monkeypatch.delenv("AGENTTRACE_KEY", raising=False)
    sent = []

    def handler(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        return httpx.Response(201, json={"runId": "run_1"})

    def mask(value):
        if isinstance(value, str):
            return value.replace("Jane Doe", "<name>")
        if isinstance(value, dict):
            return {k: mask(v) for k, v in value.items()}
        if isinstance(value, list):
            return [mask(v) for v in value]
        return value

    shim = _fresh("agenttrace_langchain")
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        client = shim.AsyncAgentTraceClient(url="http://localhost:3000/api/events", api_key=None, client=http)
        h = shim.AgentTraceCallbackHandler("session for Jane Doe", client=client, anonymizer=mask)
        h.on_user_message("Is Jane Doe eligible?")
        h.approval_required([{"patient": "Jane Doe"}])
        await h.finish("completed", answer="Jane Doe is eligible")
        await h.aclose()

    assert len(sent) == 5  # create, user message, approval, final answer, end
    assert all("authorization" not in r.headers for r in sent)
    wire = [json.loads(r.content) for r in sent]
    assert "Jane Doe" not in str(wire)
    assert wire[0]["name"] == "session for <name>" and "project" in wire[0]
