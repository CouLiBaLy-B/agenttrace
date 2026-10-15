"""Deprecated: the LangChain integration now ships inside `lanetrace`
(formerly AgentTrace / deepagents-trace) as `lanetrace.langchain` (plus
`lanetrace.tracking`). This package only re-exports the old names.
`AgentTraceCallbackHandler` here is the 0.2.2 async per-request handler, now
`lanetrace.langchain.AsyncLaneTraceCallbackHandler` (not the sync
`lanetrace.langchain.LaneTraceCallbackHandler` that `autolog()` uses)."""

import warnings

from lanetrace.langchain.async_callback import AsyncLaneTraceCallbackHandler as AgentTraceCallbackHandler
from lanetrace.langchain.middleware import LaneTraceMiddleware as AgentTraceMiddleware
from lanetrace.tracking.async_http import AsyncHttpEventClient as AsyncAgentTraceClient
from lanetrace.tracking.async_run import AsyncLaneTraceRun as AsyncAgentTraceRun
from lanetrace.tracking.http import LaneTraceRun as AgentTraceRun
from lanetrace.tracking.http import HttpEventClient as AgentTraceClient

warnings.warn(
    "agenttrace_langchain is deprecated: use `import lanetrace.langchain` "
    "(pip install 'lanetrace[langchain]').",
    DeprecationWarning,
    stacklevel=2,
)

__all__ = [
    "AgentTraceCallbackHandler",
    "AgentTraceClient",
    "AgentTraceMiddleware",
    "AgentTraceRun",
    "AsyncAgentTraceClient",
    "AsyncAgentTraceRun",
]
