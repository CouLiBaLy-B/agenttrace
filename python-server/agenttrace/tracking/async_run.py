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
logged), bounded payloads (`run.truncate`/`compact`). Without an API key it
posts keyless (for a local `agenttrace ui --auth none`) and names the project.

`on_stream_event`'s tool_call/tool_result mapping accepts an optional
`tool_server` callback so an app can attach its own "which backend serves
this tool" label (e.g. MCP server routing) without the library hardcoding
any app-specific tool-naming convention.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, Callable, Optional

from .async_http import AsyncHttpEventClient
from .fluent import get_project
from .run import ANSWER_LIMIT, LABEL_LIMIT, PAYLOAD_LIMIT, RESULT_LIMIT, compact, truncate

logger = logging.getLogger(__name__)


def _elapsed_ms(started: Optional[float]) -> Optional[int]:
    return int((time.monotonic() - started) * 1000) if started is not None else None


def json_safe(value: Any) -> Any:
    """A JSON-safe copy of `value` WITHOUT truncation (non-JSON leaves become
    `str()`), so an anonymizer sees every bit of text before it is bounded."""
    try:
        return json.loads(json.dumps(value, ensure_ascii=False, default=str))
    except (TypeError, ValueError):  # e.g. circular references
        return str(value)


def text_bound(limit: int) -> Callable[[Any], str]:
    """A bound for a free-text field: `str()` it, then truncate to `limit`."""
    return lambda value: truncate(str(value), limit)


def optional_text_bound(limit: int) -> Callable[[Any], Optional[str]]:
    """Like `text_bound`, but keeps `None` as `None`."""
    return lambda value: None if value is None else truncate(str(value), limit)


def unbounded(value: Any) -> Any:
    """A bound that leaves the (already anonymized) value as-is."""
    return value


def _call_label_bound(name: str) -> Callable[[Any], str]:
    """`name(args)` label: keep the tool name, truncate the args part to 60."""
    head = f"{name}("

    def bound(label: Any) -> str:
        text = str(label)
        if text.startswith(head) and text.endswith(")"):
            return f"{head}{truncate(text[len(head):-1], 60)})"
        return truncate(text, LABEL_LIMIT)

    return bound


def _bound_payload(payload: Any, bounds: Optional[dict[str, Callable[[Any], Any]]]) -> Any:
    if bounds is None:
        return payload
    if not isinstance(payload, dict):
        return compact(payload)
    return {key: bounds.get(key, compact)(value) for key, value in payload.items()}


# What a field becomes when the anonymizer raises (fail closed).
REDACTED_PAYLOAD = {"redacted": "anonymizer failed"}
REDACTED_TEXT = "[redacted]"


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
        client: AsyncHttpEventClient,
        orchestrator: str = "Orchestrator",
        tool_server: Optional[Callable[[str], str]] = None,
        phrases: Optional[dict[str, str]] = None,
        anonymizer: Optional[Callable[[Any], Any]] = None,
    ):
        # Set first: the run name can be user-derived, so it is anonymized too.
        self._anonymizer = anonymizer
        self._anonymizer_warned = False
        self._name = truncate(self.anonymize_text(name, REDACTED_TEXT), 120)
        self._client = client
        self._orchestrator = orchestrator
        self._tool_server = tool_server
        self._phrases = {**DEFAULT_PHRASES, **(phrases or {})}
        # Optional PII scrubber (see `emit`): called with each event's payload
        # (a dict) and label (a str), and with the run name (a str). Lets an app
        # (e.g. clinical data) pass one callable once instead of masking at every
        # call site. Never fatal and fails CLOSED: if it raises, the value is
        # replaced by a redaction marker (never sent unmasked) and one warning
        # is logged per run.
        self._queue: "asyncio.Queue[Optional[dict]]" = asyncio.Queue()
        self._run_id: Optional[str] = None
        # No API key: rely on the server's `--auth none` local mode (a 401
        # disables the run with one warning naming AGENTTRACE_KEY), like the
        # sync RestStore path.
        self._failed = False
        self._tool_started: dict[str, float] = {}
        self._subagent_started: dict[str, float] = {}
        self._worker = asyncio.create_task(self._drain())

    # ----- high-level API mirroring a chat-run lifecycle -----
    # Every method below hands `emit` the RAW (untruncated) label/payload plus
    # the bounds to apply: `emit` anonymizes the full values first and only
    # then truncates, so a PII token straddling a truncation boundary can't
    # leak as a fragment the anonymizer no longer recognises.
    def on_user_message(self, message: str) -> None:
        self.emit(
            source="User",
            target=self._orchestrator,
            type="handoff",
            label=message or self._phrases["user_message_fallback"],
            payload={"message": message},
            label_bound=text_bound(LABEL_LIMIT),
            payload_bounds={"message": text_bound(PAYLOAD_LIMIT)},
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
            payload: dict[str, Any] = {"args": args}
            if self._tool_server:
                payload["server"] = self._tool_server(name)
            self.emit(
                source=actor, target=name, type="tool_call",
                label=f"{name}({args})", payload=payload,
                label_bound=_call_label_bound(name),
                payload_bounds={"args": compact, "server": unbounded},
            )
        elif kind == "tool_result":
            name = str(data.get("name", "tool"))
            if name == "task":
                return
            started = self._tool_started.pop(str(data.get("id", "")), None)
            payload = {"result": str(data.get("result", ""))}
            if self._tool_server:
                payload["server"] = self._tool_server(name)
            self.emit(
                source=name, target=actor, type="tool_result",
                label=self._phrases["tool_result"].format(name=name), payload=payload,
                duration_ms=_elapsed_ms(started),
                payload_bounds={"result": text_bound(RESULT_LIMIT), "server": unbounded},
            )
        elif kind == "agent_start" and data.get("scope") == "subagent":
            self._subagent_started[source] = time.monotonic()
            self.emit(
                source=self._orchestrator, target=source, type="handoff",
                label=self._phrases["delegate"].format(target=source),
                payload={"task": str(data.get("label", ""))},
                payload_bounds={"task": text_bound(PAYLOAD_LIMIT)},
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
                payload_bounds={"status": unbounded, "error": optional_text_bound(PAYLOAD_LIMIT)},
            )
        elif kind == "approval_required":
            self.emit(
                source=self._orchestrator, target="User", type="handoff",
                label=self._phrases["approval_required"],
                payload={"actionRequests": data.get("action_requests", [])},
                status="pending",
                payload_bounds={"actionRequests": compact},
            )
        elif kind == "final":
            self.emit(
                source=self._orchestrator, target="User", type="final_answer",
                label=self._phrases["final_answer"],
                payload={"answer": str(data.get("message", ""))},
                payload_bounds={"answer": text_bound(ANSWER_LIMIT)},
            )
        # token / todo / chart: UI-only noise for a sequence diagram — ignored.

    def on_error(self, message: str) -> None:
        self.emit(
            source=self._orchestrator, target="User", type="error",
            label=self._phrases["run_failed"], payload={"error": message},
            status="error",
            payload_bounds={"error": text_bound(PAYLOAD_LIMIT)},
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
        label_bound: Optional[Callable[[Any], str]] = None,
        payload_bounds: Optional[dict[str, Callable[[Any], Any]]] = None,
    ) -> None:
        """Queue one event. `label`/`payload` should be the full, raw values:
        they are anonymized first, then bounded — `label_bound` on the label,
        and `payload_bounds[key]` on each payload field (keys without a bound,
        or a non-dict anonymizer result, get `compact`). Without bounds the
        anonymized values are sent as-is."""
        if self._failed:
            return
        # source/target are participant names (agent, tool, model, "User") and
        # are deliberately NOT anonymized; every free-text field (label,
        # payload) goes through the anonymizer. All events, including those
        # built by on_user_message/on_stream_event/on_error, pass through here.
        event: dict[str, Any] = {"source": source, "target": target, "type": type}
        if label is not None:
            masked = self.anonymize_text(label, REDACTED_TEXT)
            event["label"] = label_bound(masked) if label_bound is not None else masked
        if payload is not None:
            # JSON-safe (untruncated) first: non-JSON objects (dataclasses,
            # LangGraph Interrupts, ...) become strings the anonymizer can
            # see, instead of being stringified unmasked later by `compact`.
            masked = self._anonymize(json_safe(payload), REDACTED_PAYLOAD)
            event["payload"] = _bound_payload(masked, payload_bounds)
        if duration_ms is not None:
            event["durationMs"] = duration_ms
        if status is not None:
            event["status"] = status
        self._queue.put_nowait(event)

    def anonymize_text(self, value: Any, redacted: str) -> str:
        """Anonymize a free-text value (label, run name, sub-agent name) as a
        str. Fails closed to `redacted` if the anonymizer raises or returns a
        non-str."""
        text = value if isinstance(value, str) else str(json_safe(value))
        masked = self._anonymize(text, redacted)
        return masked if isinstance(masked, str) else redacted

    def _anonymize(self, value: Any, redacted: Any) -> Any:
        if self._anonymizer is None:
            return value
        try:
            return self._anonymizer(value)
        except Exception as exc:  # noqa: BLE001 - tracing must never crash the run
            if not self._anonymizer_warned:
                self._anonymizer_warned = True
                # No value contents and no run name in the log: either may be PII.
                logger.warning(
                    "AgentTrace anonymizer raised %s — redacting the affected fields "
                    "(further failures in this run are not logged)",
                    type(exc).__name__,
                )
            return dict(redacted) if isinstance(redacted, dict) else redacted

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

    def _create_body(self) -> dict[str, Any]:
        body: dict[str, Any] = {"runId": None, "name": self._name}
        if not self._client.api_key:
            # Keyless servers (`--auth none`) need the project named; with a
            # key the key determines the project.
            body["project"] = get_project()
        return body

    async def _drain(self) -> None:
        while True:
            item = await self._queue.get()
            if item is None:
                return
            if self._failed:
                continue
            try:
                if self._run_id is None:
                    created = await self._client.emit(self._create_body())
                    self._run_id = created["runId"]
                await self._client.emit({"runId": self._run_id, **item})
            except Exception as exc:  # noqa: BLE001 - must never crash the caller
                self._failed = True
                logger.warning(
                    "AgentTrace disabled for run %r (emission to %s failed): %s",
                    self._name, self._client.url, exc,
                )
