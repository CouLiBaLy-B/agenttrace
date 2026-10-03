"""AgentTraceCallbackHandler — LangChain callbacks -> AgentTrace events.

Unlike the middleware (baked into one agent graph), a callback handler can
be attached globally, which is what `autolog()` does. Each root invocation
(a callback with `parent_run_id is None`) becomes one AgentTrace run, unless
a fluent run is already active — then events join it and it stays open.
Children are mapped to their root through `parent_run_id`, so concurrent
invocations never mix. Handler methods never raise.
"""

from __future__ import annotations

import functools
import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Optional
from uuid import UUID

from langchain_core.callbacks import BaseCallbackHandler

from ..tracking import fluent
from ..tracking._uri import get_tracking_uri
from ..tracking.run import ANSWER_LIMIT, LABEL_LIMIT, RESULT_LIMIT, ActiveRun, compact, truncate
from ..tracking.stores import store_for_uri
from .middleware import HANDOFF_MARKERS, _extract_handoff_target, _result_content, _token_usage

logger = logging.getLogger(__name__)


def _never_raise(method):
    @functools.wraps(method)
    def wrapper(self, *args, **kwargs):
        if not self.enabled:
            return None
        try:
            return method(self, *args, **kwargs)
        except Exception:  # noqa: BLE001 - tracing must never break the agent
            logger.debug("AgentTrace callback %s failed", method.__name__, exc_info=True)
            return None

    return wrapper


@dataclass
class _RootState:
    run: ActiveRun
    owned: bool
    started: dict[UUID, float] = field(default_factory=dict)
    names: dict[UUID, str] = field(default_factory=dict)
    had_error: bool = False


class AgentTraceCallbackHandler(BaseCallbackHandler):
    raise_error = False

    def __init__(self, orchestrator: str = "Orchestrator"):
        self.orchestrator = orchestrator
        self.enabled = True
        self._lock = threading.Lock()
        self._root_of: dict[UUID, UUID] = {}
        self._roots: dict[UUID, _RootState] = {}

    # ----- run bookkeeping -----
    def _root_state(self, run_id: UUID, parent_run_id: Optional[UUID], name: str) -> _RootState:
        with self._lock:
            root = run_id if parent_run_id is None else self._root_of.get(parent_run_id, parent_run_id)
            self._root_of[run_id] = root
            state = self._roots.get(root)
            if state is None:
                active = fluent.active_run()
                if active is not None:
                    state = _RootState(run=active, owned=False)
                else:
                    run = ActiveRun(store_for_uri(get_tracking_uri()), name, project=fluent.get_project())
                    state = _RootState(run=run, owned=True)
                self._roots[root] = state
            return state

    def _lookup(self, run_id: UUID) -> Optional[_RootState]:
        with self._lock:
            root = self._root_of.get(run_id)
            return self._roots.get(root) if root is not None else None

    def _finish_root(self, run_id: UUID, status: str, answer: Optional[str]) -> None:
        with self._lock:
            state = self._roots.pop(run_id, None)
            for child in [c for c, r in self._root_of.items() if r == run_id]:
                del self._root_of[child]
        if state is None:
            return
        if answer is not None:
            state.run.log_event(
                source=self.orchestrator,
                target="User",
                type="final_answer",
                label="final answer",
                payload={"answer": truncate(answer, ANSWER_LIMIT)},
            )
        if state.owned:
            state.run.end(status)
            state.run.close()

    def _elapsed_ms(self, state: _RootState, run_id: UUID) -> Optional[int]:
        started = state.started.pop(run_id, None)
        return int((time.monotonic() - started) * 1000) if started is not None else None

    # ----- chains (only roots matter) -----
    @_never_raise
    def on_chain_start(self, serialized, inputs, *, run_id, parent_run_id=None, **kwargs):
        name = kwargs.get("name") or (serialized or {}).get("name") or "langchain run"
        self._root_state(run_id, parent_run_id, str(name))

    @_never_raise
    def on_chain_end(self, outputs, *, run_id, parent_run_id=None, **kwargs):
        if parent_run_id is None:
            state = self._lookup(run_id)
            status = "failed" if state is not None and state.had_error else "completed"
            self._finish_root(run_id, status, _answer_text(outputs))

    @_never_raise
    def on_chain_error(self, error, *, run_id, parent_run_id=None, **kwargs):
        if parent_run_id is None:
            self._finish_root(run_id, "failed", None)

    # ----- LLM calls -----
    @_never_raise
    def on_chat_model_start(self, serialized, messages, *, run_id, parent_run_id=None, **kwargs):
        self._llm_start(serialized, run_id, parent_run_id, kwargs)

    @_never_raise
    def on_llm_start(self, serialized, prompts, *, run_id, parent_run_id=None, **kwargs):
        self._llm_start(serialized, run_id, parent_run_id, kwargs)

    def _llm_start(self, serialized, run_id, parent_run_id, kwargs) -> None:
        model = _model_name(serialized, kwargs)
        state = self._root_state(run_id, parent_run_id, model)
        state.started[run_id] = time.monotonic()
        state.names[run_id] = model

    @_never_raise
    def on_llm_end(self, response, *, run_id, parent_run_id=None, **kwargs):
        state = self._lookup(run_id)
        if state is None:
            return
        message = _first_generation_message(response)
        state.run.log_event(
            source=self.orchestrator,
            target=state.names.pop(run_id, "LLM"),
            type="llm_call",
            label="llm step",
            payload={
                "output_preview": truncate(str(_result_content(message)), 240),
                "tokens": _token_usage(message),
            },
            duration_ms=self._elapsed_ms(state, run_id),
        )
        if parent_run_id is None:
            self._finish_root(run_id, "completed", None)

    @_never_raise
    def on_llm_error(self, error, *, run_id, parent_run_id=None, **kwargs):
        state = self._lookup(run_id)
        if state is None:
            return
        state.had_error = True
        state.run.log_event(
            source=state.names.pop(run_id, "LLM"),
            target=self.orchestrator,
            type="error",
            label="llm failed",
            payload={"error": type(error).__name__, "message": str(error)},
            status="error",
        )
        if parent_run_id is None:
            self._finish_root(run_id, "failed", None)

    # ----- tools -----
    @_never_raise
    def on_tool_start(self, serialized, input_str, *, run_id, parent_run_id=None, inputs=None, **kwargs):
        tool_name = str((serialized or {}).get("name") or kwargs.get("name") or "tool")
        state = self._root_state(run_id, parent_run_id, tool_name)
        state.started[run_id] = time.monotonic()
        state.names[run_id] = tool_name
        args = inputs if inputs is not None else input_str
        state.run.log_event(
            source=self.orchestrator,
            target=tool_name,
            type="tool_call",
            label=f"{tool_name}({truncate(str(args), LABEL_LIMIT)})",
            payload={"args": compact(args)},
        )
        if any(marker in tool_name.lower() for marker in HANDOFF_MARKERS):
            sub_agent = (_extract_handoff_target(args) if isinstance(args, dict) else None) or "Sub-agent"
            state.run.log_event(
                source=self.orchestrator,
                target=sub_agent,
                type="handoff",
                label=f"delegate → {sub_agent}",
                payload={"task": compact(args, 200)},
            )

    @_never_raise
    def on_tool_end(self, output, *, run_id, parent_run_id=None, **kwargs):
        state = self._lookup(run_id)
        if state is None:
            return
        tool_name = state.names.pop(run_id, "tool")
        state.run.log_event(
            source=tool_name,
            target=self.orchestrator,
            type="tool_result",
            label=f"{tool_name} → result",
            payload={"result": truncate(str(_result_content(output)), RESULT_LIMIT)},
            duration_ms=self._elapsed_ms(state, run_id),
        )
        if parent_run_id is None:
            self._finish_root(run_id, "completed", None)

    @_never_raise
    def on_tool_error(self, error, *, run_id, parent_run_id=None, **kwargs):
        state = self._lookup(run_id)
        if state is None:
            return
        state.had_error = True
        tool_name = state.names.pop(run_id, "tool")
        state.run.log_event(
            source=tool_name,
            target=self.orchestrator,
            type="error",
            label=f"{tool_name} failed",
            payload={"error": type(error).__name__, "message": str(error)},
            status="error",
        )
        if parent_run_id is None:
            self._finish_root(run_id, "failed", None)


def _model_name(serialized: Any, kwargs: dict) -> str:
    metadata = kwargs.get("metadata") or {}
    params = kwargs.get("invocation_params") or {}
    name = metadata.get("ls_model_name") or params.get("model") or params.get("model_name")
    return str(name or (serialized or {}).get("name") or "LLM")


def _first_generation_message(response: Any) -> Any:
    try:
        generation = response.generations[0][0]
    except (AttributeError, IndexError, TypeError):
        return response
    return getattr(generation, "message", None) or generation


def _answer_text(outputs: Any) -> str:
    if isinstance(outputs, dict):
        messages = outputs.get("messages")
        if messages:
            content = getattr(messages[-1], "content", messages[-1])
            return content if isinstance(content, str) else str(content)
        if "output" in outputs:
            return str(outputs["output"])
    content = getattr(outputs, "content", outputs)
    return content if isinstance(content, str) else str(content)
