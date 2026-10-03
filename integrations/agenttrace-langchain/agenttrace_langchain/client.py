"""Deprecated alias: pre-0.2 `agenttrace_langchain.client` — use `agenttrace.tracking.http`."""

from agenttrace.tracking.http import DEFAULT_URL, VALID_EVENT_TYPES
from agenttrace.tracking.http import HttpEventClient as AgentTraceClient

__all__ = ["AgentTraceClient", "DEFAULT_URL", "VALID_EVENT_TYPES"]
