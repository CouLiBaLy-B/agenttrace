"""Deprecated alias: pre-0.2 `agenttrace_langchain.run` — use `lanetrace.tracking`."""

from lanetrace.tracking.http import LaneTraceRun as AgentTraceRun
from lanetrace.tracking.run import ANSWER_LIMIT, LABEL_LIMIT, PAYLOAD_LIMIT, RESULT_LIMIT, compact, truncate

__all__ = ["ANSWER_LIMIT", "AgentTraceRun", "LABEL_LIMIT", "PAYLOAD_LIMIT", "RESULT_LIMIT", "compact", "truncate"]
