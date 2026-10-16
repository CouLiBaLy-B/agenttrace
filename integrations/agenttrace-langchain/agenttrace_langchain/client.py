"""Deprecated alias: pre-0.2 `agenttrace_langchain.client` — use `lanetrace.tracking.http`."""

from lanetrace.tracking.http import DEFAULT_URL, VALID_EVENT_TYPES
from lanetrace.tracking.http import HttpEventClient as AgentTraceClient

__all__ = ["AgentTraceClient", "DEFAULT_URL", "VALID_EVENT_TYPES"]
