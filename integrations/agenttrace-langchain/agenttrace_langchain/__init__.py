"""Deprecated: AgentTrace's LangChain integration now ships inside
`deepagents-trace` as `agenttrace.langchain` (plus `agenttrace.tracking`).
This package only re-exports the old names."""

import warnings

from agenttrace.langchain.middleware import AgentTraceMiddleware
from agenttrace.tracking.async_http import AsyncHttpEventClient as AsyncAgentTraceClient
from agenttrace.tracking.async_run import AsyncAgentTraceRun
from agenttrace.tracking.http import AgentTraceRun
from agenttrace.tracking.http import HttpEventClient as AgentTraceClient

warnings.warn(
    "agenttrace_langchain is deprecated: use `import agenttrace.langchain` "
    "(pip install 'deepagents-trace[langchain]').",
    DeprecationWarning,
    stacklevel=2,
)

__all__ = [
    "AgentTraceClient",
    "AgentTraceMiddleware",
    "AgentTraceRun",
    "AsyncAgentTraceClient",
    "AsyncAgentTraceRun",
]
