import importlib
import sys

import pytest


def test_shim_reexports_and_warns():
    sys.modules.pop("agenttrace_langchain", None)
    with pytest.warns(DeprecationWarning, match="agenttrace.langchain"):
        shim = importlib.import_module("agenttrace_langchain")
    from agenttrace.langchain.middleware import AgentTraceMiddleware
    from agenttrace.tracking.http import HttpEventClient

    assert shim.AgentTraceMiddleware is AgentTraceMiddleware
    assert shim.AgentTraceClient is HttpEventClient
