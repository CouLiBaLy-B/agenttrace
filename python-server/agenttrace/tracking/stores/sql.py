"""Writes straight to the AgentTrace database — the zero-config default
(`./agenttrace.db`), so tracing works without any server running."""

from __future__ import annotations

from typing import Optional

from ...store import db as store_db
from ...store import events, local, models
from .base import TrackingStore

DEFAULT_PROJECT = "Default"


class SqlStore(TrackingStore):
    def __init__(self, url: str):
        self.url = url
        self._initialized = False

    def _session(self):
        if not self._initialized:
            store_db.init_db(self.url)
            self._initialized = True
        return store_db.get_sessionmaker(self.url)()

    def create_run(self, project: Optional[str], name: str) -> str:
        with self._session() as db:
            user = local.get_or_create_local_user(db)
            proj = local.get_or_create_project(db, user, project or DEFAULT_PROJECT)
            return events.create_run(db, proj.id, name).id

    def log_event(self, run_id: str, event: dict) -> None:
        with self._session() as db:
            events.append_event(db, run_id, event)

    def end_run(self, run_id: str, status: str) -> None:
        with self._session() as db:
            run = db.get(models.Run, run_id)
            if run is None:
                raise LookupError(f"AgentTrace run {run_id!r} not found in {self.url}")
            events.close_run(db, run, status)
