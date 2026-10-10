"""LangChain / deepagents integration: `autolog()` for zero-code tracing,
or `AgentTraceMiddleware` / `AgentTraceCallbackHandler` to attach explicitly,
or `AsyncAgentTraceCallbackHandler` (one per request) for async servers that
cache a compiled agent. Requires `pip install 'deepagents-trace[langchain]'`."""

from .async_callback import AsyncAgentTraceCallbackHandler
from .autolog import autolog
from .callback import AgentTraceCallbackHandler
from .middleware import AgentTraceMiddleware

__all__ = ["AgentTraceCallbackHandler", "AgentTraceMiddleware", "AsyncAgentTraceCallbackHandler", "autolog"]
