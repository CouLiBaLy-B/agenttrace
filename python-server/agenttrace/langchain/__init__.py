"""LangChain / deepagents integration: `autolog()` for zero-code tracing,
or `AgentTraceMiddleware` / `AgentTraceCallbackHandler` to attach explicitly.
Requires `pip install 'deepagents-trace[langchain]'`."""

from .autolog import autolog
from .callback import AgentTraceCallbackHandler
from .middleware import AgentTraceMiddleware

__all__ = ["AgentTraceCallbackHandler", "AgentTraceMiddleware", "autolog"]
