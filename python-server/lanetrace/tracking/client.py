"""LaneTraceClient — explicit, synchronous, fail-loud access to a tracking
store (the `MlflowClient` of LaneTrace). Use the fluent API or ActiveRun
when tracing must never break the traced program."""

from __future__ import annotations

from typing import Any, Optional

from ..store.events import VALID_EVENT_TYPES
from ._uri import get_tracking_uri
from .stores import store_for_uri

DEFAULT_PROJECT = "Default"


class LaneTraceClient:
    def __init__(self, tracking_uri: Optional[str] = None):
        self.tracking_uri = tracking_uri or get_tracking_uri()
        self._store = store_for_uri(self.tracking_uri)

    def create_run(self, name: str, project: str = DEFAULT_PROJECT) -> str:
        return self._store.create_run(project, name)

    def log_event(
        self,
        run_id: str,
        *,
        source: str,
        target: str,
        type: str,
        label: Optional[str] = None,
        payload: Optional[dict] = None,
        duration_ms: Optional[int] = None,
        status: Optional[str] = None,
    ) -> None:
        if type not in VALID_EVENT_TYPES:
            raise ValueError(f"type must be one of: {', '.join(sorted(VALID_EVENT_TYPES))}")
        event: dict[str, Any] = {"source": source, "target": target, "type": type}
        if label is not None:
            event["label"] = label
        if payload is not None:
            event["payload"] = payload
        if duration_ms is not None:
            event["durationMs"] = duration_ms
        if status is not None:
            event["status"] = status
        self._store.log_event(run_id, event)

    def end_run(self, run_id: str, status: str = "completed") -> None:
        self._store.end_run(run_id, status)


# Deprecated: the pre-0.3 name (AgentTrace was renamed LaneTrace). Same class.
AgentTraceClient = LaneTraceClient
