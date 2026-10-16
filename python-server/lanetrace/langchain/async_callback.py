"""AsyncLaneTraceCallbackHandler — trace a deepagents/LangGraph run to LaneTrace
by attaching ONE LangChain callback per request, instead of hand-mapping the
`astream_events` stream at every call site.

Why a callback (and not `LaneTraceMiddleware`): a server that compiles the
agent once and reuses it across requests can't bake a per-run middleware into
the graph. Callbacks are supplied *per invocation* via
``config={"callbacks": [handler]}``, so a fresh handler traces each request
without touching the cached graph. And unlike a hand-written stream
projection, one top-level handler fires for the main agent AND every deepagents
sub-agent automatically — LangGraph propagates callbacks down the ambient
``RunnableConfig``. (`astream_events` v2 is itself an ``AsyncCallbackHandler``,
so a callback sees the exact same `metadata`/`run_id` signals the stream does.)

Integration is minimal::

    handler = AsyncLaneTraceCallbackHandler(
        "chat run",                       # client= optional, see below
        anonymizer=my_scrubber,           # optional; every payload + label
    )
    handler.on_user_message(user_text)
    config = {"configurable": {"thread_id": tid}, "callbacks": [handler]}
    async for _ in agent.astream_events(payload, version="v2", config=config):
        ...                                # your own UI dispatch, untouched
    # things a callback can't know — the app supplies them:
    #   handler.approval_required(interrupt_info)   # HITL pause (graph state)
    await handler.finish("completed", answer=final_report)

What the callback captures on its own: LLM input (system + messages) at
`on_chat_model_start`, LLM output + token usage at `on_llm_end`, tool
call/result (with duration), sub-agent handoffs (the `task` tool and any
`handoff`/`delegate` tool), and tool/LLM errors — each attributed to the main
agent or the emitting sub-agent node.

Built on `AsyncLaneTraceRun`, so emission is non-blocking, never fatal, and
payload-bounded, and the optional `anonymizer` is applied to every event's
payload (a dict) and label (a str) and to the run name; it fails closed
(redacts) if it raises.

It posts to a running `lanetrace ui` server. Pass ``client=`` (an
`AsyncHttpEventClient`, e.g. wrapping your own pooled ``httpx.AsyncClient``)
or omit it to post to the tracking URI (``LANETRACE_TRACKING_URI``, which
must be ``http(s)://``), with the key from ``LANETRACE_KEY`` if set.

Not to be confused with `LaneTraceCallbackHandler` (`callback.py`), the sync
handler `autolog()` registers globally.
"""

from __future__ import annotations

import logging
import time
from typing import Any, Callable, Optional
from uuid import UUID

from langchain_core.callbacks import AsyncCallbackHandler

from ..tracking._uri import events_url, get_tracking_uri, is_http_uri
from ..tracking.async_http import AsyncHttpEventClient
from ..tracking.async_run import AsyncAgentTraceRun, AsyncLaneTraceRun, text_bound, unbounded  # noqa: F401 - AsyncAgentTraceRun: 0.2 re-export (deprecated)
from ..tracking.run import PAYLOAD_LIMIT
from .projection import (
    SUBAGENT_NAME_LIMIT,
    bound_input,
    emitting_agent,
    extract_handoff_target,
    is_handoff_tool,
    messages_preview,
    response_preview,
    token_usage,
)

logger = logging.getLogger(__name__)

# LangGraph's namespace separator: a graph run inside a task of another graph
# gets the namespace "<parent task ns>|<own node>:<task id>".
NS_SEP = "|"


def _namespace(metadata: Any) -> str:
    """The LangGraph namespace a callback ran in. `langgraph_checkpoint_ns` is
    set for every task. `checkpoint_ns` can be stale: some langgraph releases
    (seen with 1.1.10 to 1.2.2) write it into a compiled sub-agent's own config
    metadata the first time the sub-agent runs inside a tool, so a cached
    sub-agent reports that first request's namespace on every later request."""
    md = metadata or {}
    return md.get("langgraph_checkpoint_ns") or md.get("checkpoint_ns") or ""


def _llm_output_message(response: Any) -> Any:
    """The generated message from an `LLMResult` — `generations[0][0].message`
    (a full `AIMessage`, carrying content + usage_metadata) or, failing that,
    the `ChatGeneration` itself (has `.text`). `None` if the shape is unknown."""
    try:
        gen = response.generations[0][0]
    except (AttributeError, IndexError, TypeError):
        return None
    return getattr(gen, "message", None) or gen


def _default_client() -> AsyncHttpEventClient:
    uri = get_tracking_uri()
    if not is_http_uri(uri):
        raise ValueError(
            "AsyncLaneTraceCallbackHandler posts to a running `lanetrace ui` server, "
            f"but the tracking URI is {uri!r}. Start `lanetrace ui` and set "
            "LANETRACE_TRACKING_URI=http://host:port (or pass client=AsyncHttpEventClient(...))."
        )
    return AsyncHttpEventClient(url=events_url(uri))


class AsyncLaneTraceCallbackHandler(AsyncCallbackHandler):
    def __init__(
        self,
        name: str,
        *,
        client: Optional[AsyncHttpEventClient] = None,
        orchestrator: str = "Orchestrator",
        tool_server: Optional[Callable[[str], str]] = None,
        phrases: Optional[dict[str, str]] = None,
        anonymizer: Optional[Callable[[Any], Any]] = None,
    ):
        if client is None:
            client = _default_client()
        self._run = AsyncLaneTraceRun(
            name,
            client=client,
            orchestrator=orchestrator,
            tool_server=tool_server,
            phrases=phrases,
            anonymizer=anonymizer,
        )
        self._orchestrator = orchestrator
        # Per-run_id state: LLM calls (input preview + node + start time) and
        # tool calls (name + node + handoff target + start time). Callbacks
        # give `metadata` only on the *_start hooks, so it must be stashed for
        # use at *_end. run_id pairs a start with its end reliably.
        self._llm: dict[UUID, dict[str, Any]] = {}
        self._tools: dict[UUID, dict[str, Any]] = {}
        # Model label remembered from the first call that exposes one, reused
        # for later calls whose metadata omits it. Without this, a run mixes a
        # real name ("zai.glm-5") with a fallback and the diagram sprouts two
        # LLM lanes for one model.
        self._model_name: Optional[str] = None
        # namespace (see `_namespace`) → sub-agent name. deepagents runs a
        # delegated sub-agent under the `task` tool's ns; the sub-agent's own
        # LLM/tool calls run under that ns, but `langgraph_node` stays
        # structural ("model"/"tools") and never names the sub-agent. Recording
        # the ns at the `task` call is the only way to attribute those inner
        # calls to the right sub-agent.
        self._subagent_ns: dict[str, str] = {}

    @property
    def run(self) -> AsyncLaneTraceRun:
        return self._run

    # ----- app-supplied lifecycle (things a callback can't derive) -----
    def on_user_message(self, message: str) -> None:
        self._run.on_user_message(message)

    def approval_required(self, info: Any) -> None:
        """A HITL interrupt (detected by the app via graph state, not a
        callback event)."""
        self._run.on_stream_event("approval_required", "main", {"action_requests": info})

    def on_error(self, message: str) -> None:
        """A run-level failure the app wants on the diagram (proxy to the run)."""
        self._run.on_error(message)

    async def finish(self, status: str = "completed", *, answer: Optional[str] = None) -> None:
        """Emit the final answer (the app's assembled result — not the raw LLM
        output a callback sees) and mark the run ended. Does NOT drain: call
        `aclose()` afterwards (an app may want to drain *after* sending its own
        'done' to the client so tracing never adds latency)."""
        if answer is not None:
            self._run.on_stream_event("final", "main", {"message": answer})
        self._run.end("failed" if status in ("error", "failed") else "completed")

    async def aclose(self, timeout: float = 10.0) -> None:
        """Drain the queued events (bounded wait) and stop the background task."""
        await self._run.aclose(timeout)

    # ----- LLM calls -----
    async def on_chat_model_start(
        self, serialized, messages, *, run_id: UUID, metadata=None, **kwargs
    ) -> None:
        # `messages` is list[list[BaseMessage]] — one inner list per prompt.
        msgs = messages[0] if messages and isinstance(messages[0], list) else messages
        self._llm[run_id] = {
            # Full text: anonymized before it is bounded (see on_llm_end).
            "input": messages_preview(msgs, limit=None, system_limit=None),
            "metadata": metadata or {},
            "model": self._resolve_model(serialized, metadata),
            "start": time.monotonic(),
        }

    async def on_llm_start(
        self, serialized, prompts, *, run_id: UUID, metadata=None, **kwargs
    ) -> None:
        # Text-completion models (no chat interface): keep the raw prompts.
        self._llm[run_id] = {
            "input": {"prompts": [str(p) for p in (prompts or [])]},
            "metadata": metadata or {},
            "model": self._resolve_model(serialized, metadata),
            "start": time.monotonic(),
        }

    async def on_llm_end(self, response, *, run_id: UUID, **kwargs) -> None:
        info = self._llm.pop(run_id, {})
        message = _llm_output_message(response)
        tokens = token_usage(message)
        if tokens is None:
            llm_output = getattr(response, "llm_output", None)
            if isinstance(llm_output, dict):
                tokens = llm_output.get("token_usage") or llm_output.get("usage")
        node = self._attribution(info.get("metadata"))
        self._run.emit(
            source=self._orchestrator if node == "main" else node,
            target=info.get("model") or "LLM",
            type="llm_call",
            label="llm step",
            payload={
                "input": info.get("input") or {},
                "output_preview": response_preview(message),
                "tokens": tokens,
            },
            duration_ms=self._elapsed(info.get("start")),
            # Raw values above; AsyncLaneTraceRun.emit anonymizes, then bounds.
            payload_bounds={"input": bound_input, "output_preview": text_bound(240), "tokens": unbounded},
        )

    async def on_llm_error(self, error, *, run_id: UUID, **kwargs) -> None:
        info = self._llm.pop(run_id, {})
        node = self._attribution(info.get("metadata"))
        self._run.emit(
            source=info.get("model") or "LLM",
            target=self._orchestrator if node == "main" else node,
            type="error",
            label="llm failed",
            payload={"error": type(error).__name__, "message": str(error)},
            status="error",
            payload_bounds={"error": unbounded, "message": text_bound(PAYLOAD_LIMIT)},
        )

    # ----- tool calls (deepagents tools + sub-agent handoffs) -----
    async def on_tool_start(
        self, serialized, input_str, *, run_id: UUID, metadata=None, inputs=None, **kwargs
    ) -> None:
        name = self._tool_name(serialized, kwargs)
        node = self._attribution(metadata)
        args = inputs if inputs is not None else input_str
        is_handoff = is_handoff_tool(name)
        self._tools[run_id] = {"name": name, "node": node, "handoff": is_handoff}
        if is_handoff:
            target = self._handoff_target(inputs)
            self._tools[run_id]["target"] = target
            # The sub-agent runs under this `task` call's namespace; record it
            # so the sub-agent's inner LLM/tool calls (same ns, or nested under
            # it) attribute to `target` rather than collapsing to the
            # orchestrator.
            ns = _namespace(metadata)
            if ns:
                self._subagent_ns[ns] = target
            # agent_start records the sub-agent start (for duration) and emits
            # the Orchestrator → Sub-agent handoff arrow.
            self._run.on_stream_event(
                "agent_start", target, {"scope": "subagent", "label": str(args)}
            )
        else:
            self._run.on_stream_event(
                "tool_call", node, {"id": str(run_id), "name": name, "args": args}
            )

    async def on_tool_end(self, output, *, run_id: UUID, **kwargs) -> None:
        info = self._tools.pop(run_id, {})
        if not info:
            return
        if info.get("handoff"):
            self._run.on_stream_event(
                "agent_end",
                info.get("target") or "Sub-agent",
                {"scope": "subagent", "status": "completed"},
            )
        else:
            # The tool's content as text (a ToolMessage would otherwise be sent
            # as its repr, "content='...' name=... tool_call_id=..."), full
            # length: the run anonymizes it before truncating it.
            self._run.on_stream_event(
                "tool_result",
                info.get("node", "main"),
                {"id": str(run_id), "name": info.get("name", "tool"), "result": response_preview(output)},
            )

    async def on_tool_error(self, error, *, run_id: UUID, **kwargs) -> None:
        info = self._tools.pop(run_id, {})
        if info.get("handoff"):
            self._run.on_stream_event(
                "agent_end",
                info.get("target") or "Sub-agent",
                {"scope": "subagent", "status": "failed", "error": str(error)},
            )
            return
        name = info.get("name", "tool")
        node = info.get("node", "main")
        self._run.emit(
            source=name,
            target=self._orchestrator if node == "main" else node,
            type="error",
            label=f"{name} failed",
            payload={"error": type(error).__name__, "message": str(error)},
            status="error",
            payload_bounds={"error": unbounded, "message": text_bound(PAYLOAD_LIMIT)},
        )

    # ----- helpers -----
    def _handoff_target(self, inputs: Any) -> str:
        """Sub-agent name from the delegation args (`subagent_type` first).
        It is user/LLM-derived and becomes a participant name (never
        anonymized as such), so it goes through the anonymizer here: if the
        anonymizer changes it, fails, or there is none to read, it's
        "Sub-agent". Capped to SUBAGENT_NAME_LIMIT chars."""
        raw = extract_handoff_target(inputs)
        if not raw:
            return "Sub-agent"
        raw = str(raw)
        if self._run.anonymize_text(raw, "Sub-agent") != raw:  # full value, then cap
            return "Sub-agent"
        return raw[:SUBAGENT_NAME_LIMIT]

    def _attribution(self, metadata: Any) -> str:
        """Emitter of a call: ``"main"`` or a named sub-agent. First matches the
        call's namespace against the sub-agent namespaces recorded at `task`
        time (deepagents' only reliable sub-agent signal; the innermost one
        wins for nested sub-agents), then falls back to the
        structural-node-aware `emitting_agent`."""
        ns = _namespace(metadata)
        matches = [sub_ns for sub_ns in self._subagent_ns if ns == sub_ns or ns.startswith(sub_ns + NS_SEP)]
        if matches:
            return self._subagent_ns[max(matches, key=len)]
        return emitting_agent(metadata)

    @staticmethod
    def _elapsed(started: Optional[float]) -> Optional[int]:
        return int((time.monotonic() - started) * 1000) if started is not None else None

    def _resolve_model(self, serialized: Any, metadata: Any) -> str:
        """A single, stable model label for the whole run.

        Prefer LangChain's ``metadata["ls_model_name"]`` (the real model id,
        e.g. ``zai.glm-5``), else the model id in the serialized kwargs. The
        first label found is remembered and reused for later calls whose
        metadata omits it — otherwise one model would render as two LLM lanes
        (a named one + a fallback one). Never uses ``serialized["name"]``, which
        is often the class name (``ChatOpenAI``) or a generic ``model`` node
        label, not the model itself.
        """
        md = metadata or {}
        name = md.get("ls_model_name")
        if not name and isinstance(serialized, dict):
            kwargs = serialized.get("kwargs")
            if isinstance(kwargs, dict):
                name = kwargs.get("model") or kwargs.get("model_name") or kwargs.get("model_id")
        if name:
            self._model_name = str(name)
        return self._model_name or "LLM"

    @staticmethod
    def _tool_name(serialized: Any, kwargs: dict) -> str:
        if isinstance(serialized, dict) and serialized.get("name"):
            return str(serialized["name"])
        return str(kwargs.get("name") or "tool")


# Deprecated: the pre-0.3 name (AgentTrace was renamed LaneTrace). Same class.
AsyncAgentTraceCallbackHandler = AsyncLaneTraceCallbackHandler
