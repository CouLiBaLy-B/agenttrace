"""AgentTraceRun — non-blocking, never-fatal event emission for one run.

`AgentTraceClient` (client.py) is the low-level, fail-loud HTTP primitive: it
raises on a missing key or a failed request, which is the right behavior for
someone calling it directly. Embedded inside an agent's runtime that must
never crash or stall a user-facing chat because of an observability backend,
those guarantees are wrong — so `AgentTraceRun` wraps it with the same
non-blocking/never-fatal contract used in production AgentTrace integrations:

- **non-blocking**: `emit()`/`end()` push onto a queue drained by a single
  background thread per run (FIFO order preserved, matching AgentTrace's
  `seq` ordering);
- **never fatal**: the first network error (or a missing API key) disables
  the run permanently (one warning logged), the caller's agent keeps running;
- **bounded payloads**: use `truncate`/`compact` when building event payloads
  so a single large tool result or answer can't blow up an event body.
"""

from __future__ import annotations

import json
import logging
import queue
import threading
from typing import Any, Optional

from .client import AgentTraceClient

logger = logging.getLogger(__name__)

LABEL_LIMIT = 80
PAYLOAD_LIMIT = 2000
RESULT_LIMIT = 500
ANSWER_LIMIT = 500


def truncate(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[:limit] + "…"


def compact(value: Any, limit: int = PAYLOAD_LIMIT) -> Any:
    """Return `value` as-is if its JSON form is compact, else a truncated preview."""
    try:
        text = json.dumps(value, ensure_ascii=False, default=str)
    except (TypeError, ValueError):
        return truncate(repr(value), limit)
    if len(text) <= limit:
        return value
    return truncate(text, limit)


class AgentTraceRun:
    """One instance = one AgentTrace run. Every public method is non-blocking.

    The remote run is created lazily (first queued item) by the background
    worker thread; `close()` waits (bounded) for the queue to drain.
    """

    def __init__(self, name: str, *, client: AgentTraceClient):
        self._name = truncate(name, 120)
        self._client = client
        self._queue: "queue.Queue[Optional[dict]]" = queue.Queue()
        self._run_id: Optional[str] = None
        self._failed = not bool(client.api_key)
        if self._failed:
            logger.warning(
                "AgentTrace tracing disabled for run %r — no API key configured "
                "(pass api_key=... or set AGENTTRACE_KEY).",
                self._name,
            )
        self._thread = threading.Thread(target=self._drain, daemon=True)
        self._thread.start()

    def emit(
        self,
        *,
        source: str,
        target: str,
        type: str,
        label: Optional[str] = None,
        payload: Optional[dict] = None,
        duration_ms: Optional[int] = None,
        status: Optional[str] = None,
    ) -> None:
        if self._failed:
            return
        event: dict[str, Any] = {"source": source, "target": target, "type": type}
        if label is not None:
            event["label"] = label
        if payload is not None:
            event["payload"] = payload
        if duration_ms is not None:
            event["durationMs"] = duration_ms
        if status is not None:
            event["status"] = status
        self._queue.put_nowait(event)

    def end(self, status: str = "completed") -> None:
        if self._failed:
            return
        self._queue.put_nowait({"endRun": status})

    def close(self, timeout: float = 10.0) -> None:
        """Signal the worker to stop and wait (bounded) for the queue to drain."""
        self._queue.put_nowait(None)
        self._thread.join(timeout)

    def _drain(self) -> None:
        while True:
            item = self._queue.get()
            if item is None:
                return
            if self._failed:
                continue  # drain without emitting once disabled
            try:
                if self._run_id is None:
                    created = self._client.emit({"runId": None, "name": self._name})
                    self._run_id = created["runId"]
                self._client.emit({"runId": self._run_id, **item})
            except Exception as exc:  # noqa: BLE001 - must never crash the caller
                self._failed = True
                logger.warning(
                    "AgentTrace disabled for run %r (emission to %s failed): %s",
                    self._name,
                    self._client.url,
                    exc,
                )
