"""AsyncAgentTraceRun — asyncio-native run tracer for servers that already
run inside an event loop (FastAPI, etc.) and drive DeepAgents/LangGraph via a
custom stream projection rather than `agent.invoke()`/`.ainvoke()` directly.

This is a DIFFERENT tool than `AgentTraceMiddleware` (middleware.py) / the
thread-based `AgentTraceRun` (run.py). Those attach to `create_deep_agent(...,
middleware=[...])` and assume the agent graph is built fresh per invocation —
they don't fit a server that **caches and reuses a compiled agent across many
runs** (a middleware instance is baked into the graph at build time, so it
can't be swapped in per-run). If your server does its own event-stream
projection (turning `agent.astream_events(...)` into typed events) and needs
one AgentTrace run per logical request regardless of how long the underlying
agent object is cached, use `AsyncAgentTraceRun` instead: create one per run
(not per agent build), feed it events via `on_stream_event(kind, source,
data)`, and close it when the run ends.

Guarantees (same contract as the thread-based `AgentTraceRun`, ported to
asyncio): non-blocking (`asyncio.Queue` drained by a single background task
per run), never fatal (first HTTP failure disables the run, one warning
logged), bounded payloads (`run.truncate`/`compact`).

`on_stream_event`'s tool_call/tool_result mapping accepts an optional
`tool_server` callback so an app can attach its own "which backend serves
this tool" label (e.g. MCP server routing) without the library hardcoding
any app-specific tool-naming convention.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Callable, Optional

from .async_client import AsyncAgentTraceClient
from .run import ANSWER_LIMIT, LABEL_LIMIT, PAYLOAD_LIMIT, RESULT_LIMIT, compact, truncate

logger = logging.getLogger(__name__)


def _elapsed_ms(started: Optional[float]) -> Optional[int]:
    return int((time.monotonic() - started) * 1000) if started is not None else None


# Diagram-label strings, overridable via `AsyncAgentTraceRun(phrases=...)` —
# e.g. to localize them, or to match wording an app already shipped before
# adopting this library. `{name}`/`{target}` are filled with `str.format`.
DEFAULT_PHRASES = {
    "user_message_fallback": "user message",
    "tool_result": "{name} → result",
    "delegate": "delegate → {target}",
    "subagent_done": "{name} → done",
    "subagent_failed": "{name} → failed",
    "approval_required": "HITL: approval required",
    "final_answer": "final answer",
    "run_failed": "run failed",
}


class AsyncAgentTraceRun:
    """One instance = one run (created per request, NOT per cached agent build).

    Every public method is non-blocking except `aclose()`, which awaits
    (bounded) for the queue to drain.
    """

    def __init__(
        self,
        name: str,
        *,
        client: AsyncAgentTraceClient,
        orchestrator: str = "Orchestrator",
        tool_server: Optional[Callable[[str], str]] = None,
        phrases: Optional[dict[str, str]] = None,
        anonymizer: Optional[Callable[[Any], Any]] = None,
    ):
        self._name = truncate(name, 120)
        self._client = client
        self._orchestrator = orchestrator
        self._tool_server = tool_server
        self._phrases = {**DEFAULT_PHRASES, **(phrases or {})}
        # Optional PII scrubber applied to every event payload right before it
        # is queued (see `emit`). Lets an app (e.g. clinical data) pass one
        # callable once instead of masking at every call site. Never fatal: a
        # failing anonymizer logs a warning and the payload passes through, so
        # tracing can't crash the run it's observing.
        self._anonymizer = anonymizer
        self._queue: "asyncio.Queue[Optional[dict]]" = asyncio.Queue()
        self._run_id: Optional[str] = None
        self._failed = not bool(client.api_key)
        if self._failed:
            logger.warning(
                "AgentTrace tracing disabled for run %r — no API key configured "
                "(pass api_key=... to the client or set AGENTTRACE_KEY).",
                self._name,
            )
        self._tool_started: dict[str, float] = {}
        self._subagent_started: dict[str, float] = {}
        self._worker = asyncio.create_task(self._drain())

    # ----- high-level API mirroring a chat-run lifecycle -----
    def on_user_message(self, message: str) -> None:
        self.emit(
            source="User",
            target=self._orchestrator,
            type="handoff",
            label=truncate(message, LABEL_LIMIT) or self._phrases["user_message_fallback"],
            payload={"message": truncate(message, PAYLOAD_LIMIT)},
        )

    def on_stream_event(self, kind: str, source: str, data: dict[str, Any]) -> None:
        """Map a (kind, source, data) stream-projection event onto an AgentTrace arrow.

        Expected `kind` values: tool_call, tool_result, agent_start, agent_end
        (subagent scope only), approval_required, final. Anything else
        (tokens, todos, charts — UI-only noise for a sequence diagram) is
        ignored, matching the original SIIGMA stream-projection mapping this
        was ported from.
        """
        actor = self._orchestrator if source == "main" else source

        if kind == "tool_call":
            name = str(data.get("name", "tool"))
            if name == "task":
                return  # delegation is already traced via agent_start/agent_end
            tool_id = str(data.get("id", ""))
            self._tool_started[tool_id] = time.monotonic()
            args = data.get("args", {})
            args_preview = truncate(str(args), 60)
            payload: dict[str, Any] = {"args": compact(args)}
            if self._tool_server:
                payload["server"] = self._tool_server(name)
            self.emit(
                source=actor, target=name, type="tool_call",
                label=f"{name}({args_preview})", payload=payload,
            )
        elif kind == "tool_result":
            name = str(data.get("name", "tool"))
            if name == "task":
                return
            started = self._tool_started.pop(str(data.get("id", "")), None)
            payload = {"result": truncate(str(data.get("result", "")), RESULT_LIMIT)}
            if self._tool_server:
                payload["server"] = self._tool_server(name)
            self.emit(
                source=name, target=actor, type="tool_result",
                label=self._phrases["tool_result"].format(name=name), payload=payload,
                duration_ms=_elapsed_ms(started),
            )
        elif kind == "agent_start" and data.get("scope") == "subagent":
            self._subagent_started[source] = time.monotonic()
            self.emit(
                source=self._orchestrator, target=source, type="handoff",
                label=self._phrases["delegate"].format(target=source),
                payload={"task": truncate(str(data.get("label", "")), PAYLOAD_LIMIT)},
            )
        elif kind == "agent_end" and data.get("scope") == "subagent":
            started = self._subagent_started.pop(source, None)
            failed = data.get("status") == "failed"
            label_key = "subagent_failed" if failed else "subagent_done"
            self.emit(
                source=source, target=self._orchestrator,
                type="error" if failed else "tool_result",
                label=self._phrases[label_key].format(name=source),
                payload={"status": data.get("status"), "error": data.get("error")},
                duration_ms=_elapsed_ms(started), status="error" if failed else "ok",
            )
        elif kind == "approval_required":
            self.emit(
                source=self._orchestrator, target="User", type="handoff",
                label=self._phrases["approval_required"],
                payload={"actionRequests": compact(data.get("action_requests", []))},
                status="pending",
            )
        elif kind == "final":
            self.emit(
                source=self._orchestrator, target="User", type="final_answer",
                label=self._phrases["final_answer"],
                payload={"answer": truncate(str(data.get("message", "")), ANSWER_LIMIT)},
            )
        # token / todo / chart: UI-only noise for a sequence diagram — ignored.

    def on_error(self, message: str) -> None:
        self.emit(
            source=self._orchestrator, target="User", type="error",
            label=self._phrases["run_failed"], payload={"error": truncate(message, PAYLOAD_LIMIT)},
            status="error",
        )

    # ----- low-level emit / lifecycle -----
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
            event["payload"] = self._anonymize(payload)
        if duration_ms is not None:
            event["durationMs"] = duration_ms
        if status is not None:
            event["status"] = status
        self._queue.put_nowait(event)

    def _anonymize(self, payload: Any) -> Any:
        if self._anonymizer is None:
            return payload
        try:
            return self._anonymizer(payload)
        except Exception:  # noqa: BLE001 - tracing must never crash the run
            logger.warning(
                "AgentTrace anonymizer raised for run %r — payload sent unmasked", self._name
            )
            return payload

    def end(self, status: str = "completed") -> None:
        if self._failed:
            return
        self._queue.put_nowait({"endRun": status})

    async def aclose(self, timeout: float = 10.0) -> None:
        """Signal the worker to stop and wait (bounded) for the queue to drain."""
        self._queue.put_nowait(None)
        try:
            await asyncio.wait_for(self._worker, timeout=timeout)
        except Exception:  # noqa: BLE001 - tracing must never block shutdown
            self._worker.cancel()

    async def _drain(self) -> None:
        while True:
            item = await self._queue.get()
            if item is None:
                return
            if self._failed:
                continue
            try:
                if self._run_id is None:
                    created = await self._client.emit({"runId": None, "name": self._name})
                    self._run_id = created["runId"]
                await self._client.emit({"runId": self._run_id, **item})
            except Exception as exc:  # noqa: BLE001 - must never crash the caller
                self._failed = True
                logger.warning(
                    "AgentTrace disabled for run %r (emission to %s failed): %s",
                    self._name, self._client.url, exc,
                )
