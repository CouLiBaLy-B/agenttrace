"""AgentTraceCallbackHandler — trace a deepagents/LangGraph run to AgentTrace
by attaching ONE LangChain callback per request, instead of hand-mapping the
`astream_events` stream at every call site.

Why a callback (and not `AgentTraceMiddleware`): a server that compiles the
agent once and reuses it across requests can't bake a per-run middleware into
the graph. Callbacks are supplied *per invocation* via
``config={"callbacks": [handler]}``, so a fresh handler traces each request
without touching the cached graph. And unlike a hand-written stream
projection, one top-level handler fires for the main agent AND every deepagents
sub-agent automatically — LangGraph propagates callbacks down the ambient
``RunnableConfig``. (`astream_events` v2 is itself an ``AsyncCallbackHandler``,
so a callback sees the exact same `metadata`/`run_id` signals the stream does.)

Integration is minimal::

    handler = AgentTraceCallbackHandler(
        "chat run", client=AsyncAgentTraceClient(api_key="atr_..."),
        anonymizer=my_scrubber,           # optional; applied to every payload
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

Built on `AsyncAgentTraceRun`, so emission is non-blocking, never fatal, and
payload-bounded, and the optional `anonymizer` is applied to every event.
"""

from __future__ import annotations

import logging
import time
from typing import Any, Callable, Optional
from uuid import UUID

from langchain_core.callbacks import AsyncCallbackHandler

from .async_client import AsyncAgentTraceClient
from .async_run import AsyncAgentTraceRun
from .projection import (
    HANDOFF_MARKERS,
    emitting_agent,
    extract_handoff_target,
    messages_preview,
    response_preview,
    token_usage,
)
from .run import ANSWER_LIMIT, RESULT_LIMIT, truncate

logger = logging.getLogger(__name__)


def _llm_output_message(response: Any) -> Any:
    """The generated message from an `LLMResult` — `generations[0][0].message`
    (a full `AIMessage`, carrying content + usage_metadata) or, failing that,
    the `ChatGeneration` itself (has `.text`). `None` if the shape is unknown."""
    try:
        gen = response.generations[0][0]
    except (AttributeError, IndexError, TypeError):
        return None
    return getattr(gen, "message", None) or gen


class AgentTraceCallbackHandler(AsyncCallbackHandler):
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
        self._run = AsyncAgentTraceRun(
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

    @property
    def run(self) -> AsyncAgentTraceRun:
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
            "input": messages_preview(msgs),
            "metadata": metadata or {},
            "model": self._resolve_model(serialized, metadata),
            "start": time.monotonic(),
        }

    async def on_llm_start(
        self, serialized, prompts, *, run_id: UUID, metadata=None, **kwargs
    ) -> None:
        # Text-completion models (no chat interface): keep the raw prompts.
        self._llm[run_id] = {
            "input": {"prompts": [truncate(str(p), RESULT_LIMIT) for p in (prompts or [])]},
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
        node = emitting_agent(info.get("metadata"))
        self._run.emit(
            source=self._orchestrator if node == "main" else node,
            target=info.get("model") or "LLM",
            type="llm_call",
            label="llm step",
            payload={
                "input": info.get("input") or {},
                "output_preview": truncate(response_preview(message), 240),
                "tokens": tokens,
            },
            duration_ms=self._elapsed(info.get("start")),
        )

    async def on_llm_error(self, error, *, run_id: UUID, **kwargs) -> None:
        info = self._llm.pop(run_id, {})
        node = emitting_agent(info.get("metadata"))
        self._run.emit(
            source=info.get("model") or "LLM",
            target=self._orchestrator if node == "main" else node,
            type="error",
            label="llm failed",
            payload={"error": type(error).__name__, "message": str(error)},
            status="error",
        )

    # ----- tool calls (deepagents tools + sub-agent handoffs) -----
    async def on_tool_start(
        self, serialized, input_str, *, run_id: UUID, metadata=None, inputs=None, **kwargs
    ) -> None:
        name = self._tool_name(serialized, kwargs)
        node = emitting_agent(metadata)
        args = inputs if inputs is not None else input_str
        is_handoff = any(marker in name.lower() for marker in HANDOFF_MARKERS)
        self._tools[run_id] = {"name": name, "node": node, "handoff": is_handoff}
        if is_handoff:
            target = extract_handoff_target(inputs) or "Sub-agent"
            self._tools[run_id]["target"] = target
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
            self._run.on_stream_event(
                "tool_result",
                info.get("node", "main"),
                {"id": str(run_id), "name": info.get("name", "tool"), "result": output},
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
        )

    # ----- helpers -----
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
