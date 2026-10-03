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
    from agenttrace.langchain.middleware import AgentTraceMiddleware
    from agenttrace.tracking.async_http import AsyncHttpEventClient
    from agenttrace.tracking.async_run import AsyncAgentTraceRun
    from agenttrace.tracking.http import AgentTraceRun, HttpEventClient

    assert shim.AgentTraceMiddleware is AgentTraceMiddleware
    assert shim.AgentTraceClient is HttpEventClient
    assert shim.AgentTraceRun is AgentTraceRun
    assert shim.AsyncAgentTraceClient is AsyncHttpEventClient
    assert shim.AsyncAgentTraceRun is AsyncAgentTraceRun


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
