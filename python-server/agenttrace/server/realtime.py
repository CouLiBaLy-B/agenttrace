"""WebSocket fan-out for live events + replay — replaces the standalone
Socket.IO mini-service (mini-services/socket-service/index.ts).

Because there's a single Python process (no separate Next.js-server-as-a-
Socket.IO-client hop), REST routes call `manager.broadcast_event(...)`
directly instead of forwarding to a sibling service.

Wire protocol (plain JSON over a single `/ws` WebSocket, one connection per
browser tab) — intentionally NOT the Socket.IO protocol; Phase 2 (frontend
decoupling) will adapt the client accordingly:

    -> {"action": "subscribe", "runId": "..."}
    <- {"type": "subscribed", "runId": "..."}
    <- {"type": "event", "data": {...}}                  (on new events)
    <- {"type": "run:update", "runId": "...", "patch": {...}}
    -> {"action": "unsubscribe", "runId": "..."}
    -> {"action": "replay", "runId": "...", "events": [...], "speed": 1}
    <- {"type": "replay:event", "data": {...}}  (repeated, paced by speed)
    <- {"type": "replay:done", "runId": "..."}
    -> {"action": "replay:stop", "runId": "..."}

`broadcast_event`/`broadcast_run_update` are called from sync FastAPI route
handlers (which FastAPI runs in a threadpool since they're plain `def`s), so
they schedule the actual async send onto the main event loop captured at
startup via `asyncio.run_coroutine_threadsafe`.
"""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import WebSocket


class ConnectionManager:
    def __init__(self) -> None:
        self._rooms: dict[str, set[WebSocket]] = {}
        self._replay_tasks: dict[tuple[int, str], asyncio.Task] = {}
        self._loop: asyncio.AbstractEventLoop | None = None

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    # ----- connection lifecycle -----
    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()

    def disconnect(self, websocket: WebSocket) -> None:
        for room in self._rooms.values():
            room.discard(websocket)
        for key in [k for k in self._replay_tasks if k[0] == id(websocket)]:
            self._replay_tasks.pop(key).cancel()

    async def subscribe(self, websocket: WebSocket, run_id: str) -> None:
        self._rooms.setdefault(run_id, set()).add(websocket)
        await websocket.send_json({"type": "subscribed", "runId": run_id})

    def unsubscribe(self, websocket: WebSocket, run_id: str) -> None:
        self._rooms.get(run_id, set()).discard(websocket)

    # ----- server -> subscribed clients (called from sync route handlers) -----
    def broadcast_event(self, run_id: str, event: dict[str, Any]) -> None:
        self._schedule(self._broadcast(run_id, {"type": "event", "data": event}))

    def broadcast_run_update(self, run_id: str, patch: dict[str, Any]) -> None:
        self._schedule(self._broadcast(run_id, {"type": "run:update", "runId": run_id, "patch": patch}))

    def _schedule(self, coro) -> None:
        if self._loop is None:
            return
        asyncio.run_coroutine_threadsafe(coro, self._loop)

    async def _broadcast(self, run_id: str, message: dict[str, Any]) -> None:
        for ws in list(self._rooms.get(run_id, ())):
            try:
                await ws.send_json(message)
            except Exception:  # noqa: BLE001 - a dead socket must not break the others
                self._rooms.get(run_id, set()).discard(ws)

    # ----- replay (paced playback to a single client) -----
    async def replay(self, websocket: WebSocket, run_id: str, events: list[dict], speed: float) -> None:
        self.stop_replay(websocket, run_id)

        if not events:
            await websocket.send_json({"type": "replay:done", "runId": run_id})
            return

        if not speed:
            for event in events:
                await websocket.send_json({"type": "replay:event", "data": event})
            await websocket.send_json({"type": "replay:done", "runId": run_id})
            return

        task = asyncio.create_task(self._run_replay(websocket, run_id, events, speed))
        self._replay_tasks[(id(websocket), run_id)] = task

    def stop_replay(self, websocket: WebSocket, run_id: str) -> None:
        task = self._replay_tasks.pop((id(websocket), run_id), None)
        if task:
            task.cancel()

    async def _run_replay(self, websocket: WebSocket, run_id: str, events: list[dict], speed: float) -> None:
        from datetime import datetime

        def ts(event: dict) -> float:
            return datetime.fromisoformat(event["timestamp"].replace("Z", "+00:00")).timestamp()

        base = ts(events[0])
        scale = 1 / speed
        elapsed = 0.0
        for event in events:
            offset = min((ts(event) - base) * scale, 60.0)
            if offset > elapsed:
                await asyncio.sleep(offset - elapsed)
                elapsed = offset
            await websocket.send_json({"type": "replay:event", "data": event})
        await websocket.send_json({"type": "replay:done", "runId": run_id})


manager = ConnectionManager()
