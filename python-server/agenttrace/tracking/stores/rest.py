"""Posts to a running AgentTrace server (`POST /api/events`). Without an
API key it relies on the server's `--auth none` local mode and names the
project explicitly; with a key the key determines the project."""

from __future__ import annotations

from typing import Any, Optional

import requests

from .base import TrackingStore


class RestStore(TrackingStore):
    def __init__(self, events_url: str, api_key: Optional[str] = None, timeout: float = 10.0, session: Any = None):
        self.events_url = events_url
        self.api_key = api_key
        self.timeout = timeout
        self._session = session

    def _post(self, body: dict) -> dict:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        post = self._session.post if self._session is not None else requests.post
        response = post(self.events_url, json=body, headers=headers, timeout=self.timeout)
        if response.status_code == 401 and not self.api_key:
            raise PermissionError(
                f"{self.events_url} requires an API key — set AGENTTRACE_KEY "
                "(or start the server with `agenttrace ui --auth none`)."
            )
        response.raise_for_status()
        return response.json()

    def create_run(self, project: Optional[str], name: str) -> str:
        body: dict[str, Any] = {"runId": None, "name": name}
        if project is not None:
            body["project"] = project
        return self._post(body)["runId"]

    def log_event(self, run_id: str, event: dict) -> None:
        self._post({"runId": run_id, **event})

    def end_run(self, run_id: str, status: str) -> None:
        self._post({"runId": run_id, "endRun": status})
