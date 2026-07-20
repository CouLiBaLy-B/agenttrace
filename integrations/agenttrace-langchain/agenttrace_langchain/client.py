"""HTTP client for the AgentTrace ingestion API.

Mirrors the contract implemented by `POST /api/events`
(see src/app/api/events/route.ts in the main AgentTrace repo):

    {"runId": null, "name": "..."}                     -> creates a run
    {"runId": ..., "source", "target", "type", ...}     -> appends an event
    {"runId": ..., "endRun": "completed" | "failed"}    -> closes a run

Valid event `type` values: llm_call | tool_call | tool_result | handoff |
error | final_answer.
"""

from __future__ import annotations

import os
from typing import Any, Optional

import requests

DEFAULT_URL = "http://localhost:3000/api/events"

VALID_EVENT_TYPES = {
    "llm_call",
    "tool_call",
    "tool_result",
    "handoff",
    "error",
    "final_answer",
}


class AgentTraceClient:
    """Thin wrapper around `POST /api/events`.

    Reads `AGENTTRACE_URL` / `AGENTTRACE_KEY` from the environment when not
    passed explicitly, matching the env vars used by the copy-paste snippets
    in the AgentTrace Integration tab.
    """

    def __init__(
        self,
        url: Optional[str] = None,
        api_key: Optional[str] = None,
        timeout: float = 10.0,
    ):
        self.url = url or os.getenv("AGENTTRACE_URL", DEFAULT_URL)
        self.api_key = api_key or os.getenv("AGENTTRACE_KEY")
        self.timeout = timeout

    def emit(self, event: dict) -> dict:
        """POST a single event/command to AgentTrace. Returns the parsed JSON response."""
        if not self.api_key:
            raise RuntimeError(
                "AgentTrace API key missing — pass api_key=... or set AGENTTRACE_KEY "
                "(project key from the Integration tab, prefixed 'atr_')."
            )
        response = requests.post(
            self.url,
            json=event,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            timeout=self.timeout,
        )
        response.raise_for_status()
        return response.json()

    def start_run(self, name: str) -> str:
        result = self.emit({"runId": None, "name": name})
        return result["runId"]

    def event(
        self,
        run_id: str,
        source: str,
        target: str,
        type: str,
        label: Optional[str] = None,
        payload: Optional[dict] = None,
        duration_ms: Optional[int] = None,
        status: Optional[str] = None,
    ) -> dict:
        if type not in VALID_EVENT_TYPES:
            raise ValueError(f"type must be one of: {', '.join(sorted(VALID_EVENT_TYPES))}")
        body: dict[str, Any] = {
            "runId": run_id,
            "source": source,
            "target": target,
            "type": type,
        }
        if label is not None:
            body["label"] = label
        if payload is not None:
            body["payload"] = payload
        if duration_ms is not None:
            body["durationMs"] = duration_ms
        if status is not None:
            body["status"] = status
        return self.emit(body)

    def end_run(self, run_id: str, status: str = "completed") -> dict:
        return self.emit({"runId": run_id, "endRun": status})
