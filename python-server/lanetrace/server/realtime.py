"""WebSocket fan-out for live events + replay — replaces the standalone
Socket.IO mini-service (mini-services/socket-service/index.ts).

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

Live events come from a poller (every 0.5 s, only runs with subscribers, `seq > last seen`)
instead of being pushed by the ingestion route: the SDK can write to the database directly
(SqlStore), bypassing the server, and the poller is the one path that sees both.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Any, Optional

from fastapi import WebSocket

from . import models
from .db import SessionLocal
from .serializers import _iso, event_out

logger = logging.getLogger(__name__)

POLL_INTERVAL = 0.5
MAX_SUBSCRIPTIONS_PER_SOCKET = 50


def _run_state(run: models.Run) -> tuple[str, Optional[str]]:
    return run.status, _iso(run.ended_at)


class ConnectionManager:
    def __init__(self) -> None:
        self._rooms: dict[str, set[WebSocket]] = {}
        self._replay_tasks: dict[tuple[int, str], asyncio.Task] = {}
        self._last_seq: dict[str, int] = {}
        self._run_state: dict[str, tuple[str, Optional[str]]] = {}

    # ----- connection lifecycle -----
    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()

    async def subscribe(self, websocket: WebSocket, run_id: str, user_id: Optional[str] = None) -> None:
        already = websocket in self._rooms.get(run_id, ())
        if not already and sum(1 for room in self._rooms.values() if websocket in room) >= MAX_SUBSCRIPTIONS_PER_SOCKET:
            await websocket.send_json({"type": "error", "runId": run_id, "error": "Too many subscriptions"})
            return
        initial = None
        # With a user_id (password mode) ownership is always re-checked, even if the cursor is cached.
        if user_id is not None or run_id not in self._last_seq:
            initial = await asyncio.to_thread(self._read_cursor, run_id, user_id)
            if initial is None:
                await websocket.send_json({"type": "error", "runId": run_id, "error": "Run not found"})
                return
        # From here to the room add there is no await: cursor + room change atomically on the loop.
        if initial is not None and run_id not in self._last_seq:
            self._last_seq[run_id] = initial[0]
            self._run_state[run_id] = initial[1]
        self._rooms.setdefault(run_id, set()).add(websocket)
        await websocket.send_json({"type": "subscribed", "runId": run_id})

    def unsubscribe(self, websocket: WebSocket, run_id: str) -> None:
        self._rooms.get(run_id, set()).discard(websocket)
        self._forget_if_empty(run_id)

    def disconnect(self, websocket: WebSocket) -> None:
        for run_id, room in list(self._rooms.items()):
            room.discard(websocket)
            self._forget_if_empty(run_id)
        for key in [k for k in self._replay_tasks if k[0] == id(websocket)]:
            self._replay_tasks.pop(key).cancel()

    def _forget_if_empty(self, run_id: str) -> None:
        if not self._rooms.get(run_id):
            self._rooms.pop(run_id, None)
            self._last_seq.pop(run_id, None)
            self._run_state.pop(run_id, None)

    @staticmethod
    def _read_cursor(run_id: str, user_id: Optional[str] = None) -> Optional[tuple[int, tuple[str, Optional[str]]]]:
        """Pure DB read (thread-safe): (last seq, run state), or None if the run does not exist."""
        with SessionLocal() as db:
            run = db.get(models.Run, run_id)
            if run is None:
                return None
            if user_id is not None:
                project = db.get(models.Project, run.project_id)
                if project is None or project.user_id != user_id:
                    return None
            last = (
                db.query(models.Event.seq)
                .filter(models.Event.run_id == run_id)
                .order_by(models.Event.seq.desc())
                .limit(1)
                .scalar()
            )
            return (last if last is not None else -1), _run_state(run)

    def _snapshot(self) -> dict[str, tuple[int, Optional[tuple[str, Optional[str]]]]]:
        """Watched runs with their cursor (loop only). Runs without a cursor are skipped."""
        return {
            run_id: (self._last_seq[run_id], self._run_state.get(run_id))
            for run_id, room in self._rooms.items()
            if room and run_id in self._last_seq
        }

    @staticmethod
    def _poll_snapshot(snapshot: dict) -> tuple[list[tuple[str, dict[str, Any]]], dict]:
        """DB work for one poll; touches no manager state (safe in a worker thread)."""
        messages: list[tuple[str, dict[str, Any]]] = []
        updates: dict[str, tuple[int, Optional[tuple[str, Optional[str]]]]] = {}
        if not snapshot:
            return messages, updates
        with SessionLocal() as db:
            for run_id, (last, prev_state) in snapshot.items():
                new_events = (
                    db.query(models.Event)
                    .filter(models.Event.run_id == run_id, models.Event.seq > last)
                    .order_by(models.Event.seq)
                    .all()
                )
                for event in new_events:
                    messages.append((run_id, {"type": "event", "data": event_out(event)}))
                    last = event.seq
                state = prev_state
                run = db.get(models.Run, run_id)
                if run is not None:
                    state = _run_state(run)
                    if prev_state not in (None, state):
                        messages.append(
                            (run_id, {"type": "run:update", "runId": run_id, "patch": {"status": state[0], "endedAt": state[1]}})
                        )
                updates[run_id] = (last, state)
        return messages, updates

    def _apply(self, updates: dict) -> None:
        """Store new cursors, only for runs still watched (loop only)."""
        for run_id, (last, state) in updates.items():
            if self._rooms.get(run_id) and run_id in self._last_seq:
                self._last_seq[run_id] = last
                if state is not None:
                    self._run_state[run_id] = state

    def poll_once(self) -> list[tuple[str, dict[str, Any]]]:
        """New events / status changes for every watched run (synchronous)."""
        messages, updates = self._poll_snapshot(self._snapshot())
        self._apply(updates)
        return messages

    async def poll_forever(self, interval: float = POLL_INTERVAL) -> None:
        while True:
            try:
                messages, updates = await asyncio.to_thread(self._poll_snapshot, self._snapshot())
                self._apply(updates)
                for run_id, message in messages:
                    await self._broadcast(run_id, message)
            except Exception:  # noqa: BLE001 - a DB hiccup must not kill live updates
                logger.exception("LaneTrace live poller failed; retrying")
            await asyncio.sleep(interval)

    async def _broadcast(self, run_id: str, message: dict[str, Any]) -> None:
        for ws in list(self._rooms.get(run_id, ())):
            try:
                await ws.send_json(message)
            except Exception:  # noqa: BLE001 - a dead socket must not break the others
                self._rooms.get(run_id, set()).discard(ws)
                self._forget_if_empty(run_id)

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
