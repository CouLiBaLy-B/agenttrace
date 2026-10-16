"""Deprecated alias: pre-0.2 `agenttrace_langchain.async_client` — use `lanetrace.tracking.async_http`."""

from lanetrace.tracking.async_http import AsyncHttpEventClient as AsyncAgentTraceClient

__all__ = ["AsyncAgentTraceClient"]
