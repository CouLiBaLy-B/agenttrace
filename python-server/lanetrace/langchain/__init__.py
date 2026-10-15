"""LangChain / deepagents integration: `autolog()` for zero-code tracing,
or `LaneTraceMiddleware` / `LaneTraceCallbackHandler` to attach explicitly,
or `AsyncLaneTraceCallbackHandler` (one per request) for async servers that
cache a compiled agent (with `AsyncHttpEventClient` to share an httpx client).
Requires `pip install 'lanetrace[langchain]'`.

The pre-0.3 names (`AgentTraceMiddleware`, `AgentTraceCallbackHandler`,
`AsyncAgentTraceCallbackHandler`) are deprecated aliases of the same classes."""

from .async_callback import AsyncAgentTraceCallbackHandler, AsyncLaneTraceCallbackHandler
from .autolog import autolog
from .callback import AgentTraceCallbackHandler, LaneTraceCallbackHandler
from .middleware import AgentTraceMiddleware, LaneTraceMiddleware
from ..tracking.async_http import AsyncHttpEventClient

__all__ = [
    "LaneTraceCallbackHandler",
    "LaneTraceMiddleware",
    "AsyncLaneTraceCallbackHandler",
    "AsyncHttpEventClient",
    "autolog",
    # deprecated aliases (pre-0.3 names)
    "AgentTraceCallbackHandler",
    "AgentTraceMiddleware",
    "AsyncAgentTraceCallbackHandler",
]
