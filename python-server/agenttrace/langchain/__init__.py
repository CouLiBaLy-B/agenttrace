"""LangChain / deepagents integration: `autolog()` for zero-code tracing,
or `AgentTraceMiddleware` / `AgentTraceCallbackHandler` to attach explicitly.
Requires `pip install 'deepagents-trace[langchain]'`."""

from .middleware import AgentTraceMiddleware

__all__ = ["AgentTraceMiddleware"]
