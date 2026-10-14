"""Async HTTP client for the AgentTrace ingestion API (httpx-based).

Same wire contract as `http.HttpEventClient` (see that module's docstring)
— this variant exists for callers that already run inside an asyncio event
loop (e.g. a FastAPI server) and must never block it with sync `requests`
calls. Pass your own `httpx.AsyncClient` (for connection pooling/reuse
across runs) or let one be created lazily per client instance.
"""

from __future__ import annotations

import os
from typing import Any, Optional

import httpx

from ._uri import events_url

from .http import DEFAULT_URL, VALID_EVENT_TYPES


class AsyncHttpEventClient:
    def __init__(
        self,
        url: Optional[str] = None,
        api_key: Optional[str] = None,
        timeout: float = 10.0,
        client: Optional[httpx.AsyncClient] = None,
    ):
        # Base server URL or the full /api/events URL — both accepted.
        self.url = events_url(url or os.getenv("AGENTTRACE_URL", DEFAULT_URL))
        self.api_key = api_key or os.getenv("AGENTTRACE_KEY")
        self.timeout = timeout
        self._client = client
        self._owns_client = client is None

    def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=self.timeout)
        return self._client

    async def aclose(self) -> None:
        if self._owns_client and self._client is not None:
            await self._client.aclose()

    async def emit(self, event: dict) -> dict:
        # No key: rely on the server's `--auth none` local mode (same as the
        # sync `RestStore`); a 401 then means the server wants a key.
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        response = await self._get_client().post(self.url, json=event, headers=headers)
        if response.status_code == 401 and not self.api_key:
            raise PermissionError(
                f"{self.url} requires an API key — set AGENTTRACE_KEY "
                "(or start the server with `agenttrace ui --auth none`)."
            )
        response.raise_for_status()
        return response.json()

    async def start_run(self, name: str) -> str:
        result = await self.emit({"runId": None, "name": name})
        return result["runId"]

    async def event(
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
        body: dict[str, Any] = {"runId": run_id, "source": source, "target": target, "type": type}
        if label is not None:
            body["label"] = label
        if payload is not None:
            body["payload"] = payload
        if duration_ms is not None:
            body["durationMs"] = duration_ms
        if status is not None:
            body["status"] = status
        return await self.emit(body)

    async def end_run(self, run_id: str, status: str = "completed") -> dict:
        return await self.emit({"runId": run_id, "endRun": status})
