"""The storage contract behind every run, MLflow-style: the tracking URI
picks the implementation, callers only see these three operations. `event`
dicts use the `/api/events` wire field names."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Optional


class TrackingStore(ABC):
    @abstractmethod
    def create_run(self, project: Optional[str], name: str) -> str: ...

    @abstractmethod
    def log_event(self, run_id: str, event: dict) -> None: ...

    @abstractmethod
    def end_run(self, run_id: str, status: str) -> None: ...
