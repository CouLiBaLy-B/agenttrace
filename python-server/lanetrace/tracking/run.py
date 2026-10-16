"""ActiveRun — one LaneTrace run on top of any TrackingStore, with the
contract the LangChain middleware has always had:

- **non-blocking**: `log_event()`/`end()` push onto a queue drained by one
  background thread per run (FIFO, which preserves `seq` ordering);
- **never fatal**: the first store error disables the run (one warning), the
  caller's agent keeps running — only an invalid event type raises, because
  that is a programming error;
- **lazy**: the run is created on the first queued item (or on `run_id`);
- **exit-safe**: an atexit hook ends (`completed`) and drains every run still
  open, so short scripts don't lose their last events.
"""

from __future__ import annotations

import atexit
import json
import logging
import queue
import threading
from typing import Any, Callable, Optional

from ..store.events import VALID_EVENT_TYPES
from .stores.base import TrackingStore

logger = logging.getLogger(__name__)

LABEL_LIMIT = 80
PAYLOAD_LIMIT = 2000
RESULT_LIMIT = 500
ANSWER_LIMIT = 500

_CREATE = object()  # queue marker: create the run now (used by `run_id`)
_STOP = None

_open_runs: set["ActiveRun"] = set()
_open_runs_lock = threading.Lock()


def truncate(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[:limit] + "…"


def compact(value: Any, limit: int = PAYLOAD_LIMIT) -> Any:
    """Return a JSON-safe copy of `value` (non-JSON leaves become `str()`) if
    its JSON form is compact, else a truncated preview string. Never the
    original object: a `self`, datetime or Path reaching the store would fail
    serialization there and disable the whole run."""
    try:
        text = json.dumps(value, ensure_ascii=False, default=str)
    except (TypeError, ValueError):
        return truncate(repr(value), limit)
    if len(text) <= limit:
        return json.loads(text)
    return truncate(text, limit)


class ActiveRun:
    def __init__(
        self,
        store: TrackingStore,
        name: str,
        *,
        project: Optional[str] = None,
        on_end: Optional[Callable[["ActiveRun"], None]] = None,
        disabled_reason: Optional[str] = None,
    ):
        self.name = truncate(name, 120)
        self.project = project
        self._store = store
        self._on_end = on_end
        self._queue: "queue.Queue[Any]" = queue.Queue()
        self._run_id: Optional[str] = None
        self._created = threading.Event()
        self._failed = disabled_reason is not None
        self._ended = False
        self._closed = False
        if disabled_reason:
            logger.warning("LaneTrace tracing disabled for run %r — %s", self.name, disabled_reason)
            self._created.set()
        self._thread = threading.Thread(target=self._drain, name=f"lanetrace-run-{self.name}", daemon=True)
        self._thread.start()
        with _open_runs_lock:
            _open_runs.add(self)

    # ----- public API (never blocks, never raises except ValueError) -----
    def log_event(
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
        if type not in VALID_EVENT_TYPES:
            raise ValueError(f"type must be one of: {', '.join(sorted(VALID_EVENT_TYPES))}")
        if self._failed or self._ended:
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

    emit = log_event  # pre-0.2 LaneTraceRun name, used by the middleware

    def end(self, status: str = "completed") -> None:
        if self._ended:
            return
        self._ended = True
        if not self._failed:
            self._queue.put_nowait({"endRun": status})
        if self._on_end is not None:
            self._on_end(self)

    def close(self, timeout: float = 10.0) -> None:
        if self._closed:
            return
        self._closed = True
        self._queue.put_nowait(_STOP)
        self._thread.join(timeout)
        with _open_runs_lock:
            _open_runs.discard(self)

    @property
    def run_id(self) -> Optional[str]:
        if not self._created.is_set():
            if self._closed:
                return None  # the worker is gone, nothing will create it now
            self._queue.put_nowait(_CREATE)
        self._created.wait(10.0)
        return self._run_id

    def __enter__(self) -> "ActiveRun":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        self.end("failed" if exc_type is not None else "completed")
        self.close()
        return False

    # ----- background worker -----
    def _ensure_created(self) -> None:
        if self._created.is_set():
            return
        try:
            self._run_id = self._store.create_run(self.project, self.name)
        except Exception as exc:  # noqa: BLE001 - must never crash the caller
            self._disable(exc)
        finally:
            self._created.set()

    def _drain(self) -> None:
        while True:
            item = self._queue.get()
            if item is _STOP:
                return
            if self._failed:
                continue  # drain without writing once disabled
            self._ensure_created()
            if self._failed or item is _CREATE:
                continue
            try:
                if "endRun" in item:
                    self._store.end_run(self._run_id, item["endRun"])
                else:
                    self._store.log_event(self._run_id, item)
            except Exception as exc:  # noqa: BLE001 - must never crash the caller
                self._disable(exc)

    def _disable(self, exc: Exception) -> None:
        self._failed = True
        logger.warning("LaneTrace disabled for run %r (%s): %s", self.name, type(self._store).__name__, exc)


def _close_all_open_runs() -> None:
    with _open_runs_lock:
        runs = list(_open_runs)
    for run in runs:
        run.end("completed")
        run.close(timeout=5.0)


atexit.register(_close_all_open_runs)
