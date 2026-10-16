"""LaneTraceMiddleware — streams a deepagents/LangChain agent run to
LaneTrace as a live sequence diagram.

Maps `AgentMiddleware` hooks (`langchain.agents.middleware`, LangChain's 2026
middleware system) onto LaneTrace event types:

    before_agent    -> create the LaneTrace run
    wrap_model_call -> emit `llm_call` (Orchestrator -> LLM)
    wrap_tool_call  -> emit `tool_call` / `tool_result` / `error` / `handoff`
    after_agent     -> emit `final_answer` and close the run

Sync and async variants (`wrap_tool_call`/`awrap_tool_call`, etc.) are both
implemented so the middleware behaves identically whether the agent is driven
via `.invoke()` or `.ainvoke()`.

Built on `ActiveRun` (lanetrace.tracking.run): emission is non-blocking (a background
thread drains a queue) and never fatal — a misconfigured or unreachable
LaneTrace instance disables tracing for the run (one warning logged) instead
of breaking the agent. Writes to the tracking URI (./lanetrace.db by default)
unless `url`/`api_key` are given. One middleware instance = one LaneTrace run:

    agent = create_deep_agent(
        model=model,
        tools=[...],
        middleware=[LaneTraceMiddleware(run_name="research run")],
    )
"""

from __future__ import annotations

import logging
import time
from typing import Any, Callable, Optional

from langchain.agents.middleware import AgentMiddleware

from .. import _env
from ..tracking._uri import events_url, get_tracking_uri
from ..tracking.fluent import get_project
from ..tracking.http import DEFAULT_URL
from ..tracking.run import ANSWER_LIMIT, LABEL_LIMIT, RESULT_LIMIT, ActiveRun, compact, truncate
from ..tracking.stores import TrackingStore, store_for_uri
from ..tracking.stores.rest import RestStore
from .projection import HANDOFF_MARKERS
from .projection import content_to_text as _content_to_text  # noqa: F401 - re-exported
from .projection import extract_handoff_target as _extract_handoff_target
from .projection import last_model_message as _last_model_message
from .projection import messages_preview as _messages_preview
from .projection import model_name as _model_name
from .projection import response_preview as _response_preview
from .projection import result_content as _result_content
from .projection import token_usage as _token_usage

logger = logging.getLogger(__name__)



class LaneTraceMiddleware(AgentMiddleware):
    def __init__(
        self,
        run_name: str = "deepagents run",
        orchestrator: str = "Orchestrator",
        url: Optional[str] = None,
        api_key: Optional[str] = None,
        timeout: float = 10.0,
        project: Optional[str] = None,
    ):
        super().__init__()
        self.run_name = run_name
        self.orchestrator = orchestrator
        self._url, self._api_key, self._timeout, self.project = url, api_key, timeout, project
        self._run: Optional[ActiveRun] = None
        self._had_error = False

    def _make_store(self) -> TrackingStore:
        # Explicit url/api_key keep the pre-0.2 behaviour (HTTP to a server);
        # otherwise follow the tracking URI like the rest of the SDK. Like the
        # HTTP clients, `url` may be the server's base URL or `.../api/events`.
        if self._url or self._api_key:
            return RestStore(
                events_url(self._url or _env.getenv("URL", DEFAULT_URL)),
                api_key=self._api_key or _env.getenv("KEY"),
                timeout=self._timeout,
            )
        return store_for_uri(get_tracking_uri())

    def _ensure_run(self) -> ActiveRun:
        if self._run is None:
            store = self._make_store()
            # With an API key the key determines the project (pre-0.2 body);
            # keyless servers (`--auth none`) need the project named.
            keyed = isinstance(store, RestStore) and bool(store.api_key)
            project = None if keyed else (self.project or get_project())
            self._run = ActiveRun(store, self.run_name, project=project)
        return self._run

    # ----- run lifecycle -----
    def before_agent(self, state, runtime) -> Optional[dict[str, Any]]:
        self._ensure_run()
        return None

    async def abefore_agent(self, state, runtime) -> Optional[dict[str, Any]]:
        return self.before_agent(state, runtime)

    def after_agent(self, state, runtime) -> Optional[dict[str, Any]]:
        run = self._ensure_run()
        run.emit(
            source=self.orchestrator,
            target="User",
            type="final_answer",
            label="final answer",
            payload={"answer": truncate(_last_message_text(state), ANSWER_LIMIT)},
        )
        run.end("failed" if self._had_error else "completed")
        run.close()
        return None

    async def aafter_agent(self, state, runtime) -> Optional[dict[str, Any]]:
        return self.after_agent(state, runtime)

    # ----- LLM calls -----
    def wrap_model_call(self, request, handler: Callable) -> Any:
        run = self._ensure_run()
        model_name = _model_name(request)
        start = time.time()
        response = handler(request)
        self._emit_llm_call(run, model_name, request, response, start)
        return response

    async def awrap_model_call(self, request, handler: Callable) -> Any:
        run = self._ensure_run()
        model_name = _model_name(request)
        start = time.time()
        response = await handler(request)
        self._emit_llm_call(run, model_name, request, response, start)
        return response

    def _emit_llm_call(
        self, run: ActiveRun, model_name: str, request: Any, response: Any, start: float
    ) -> None:
        # wrap_model_call's handler returns a `ModelResponse` dataclass
        # (`.result: list[BaseMessage]`), not a bare message — unwrap to the
        # last message before reading content/usage. Some middleware/tests
        # may still hand back a bare message directly, so fall back to it.
        message = _last_model_message(response)
        run.emit(
            source=self.orchestrator,
            target=model_name,
            type="llm_call",
            label="llm step",
            payload={
                "input": _messages_preview(request),
                "output_preview": truncate(_response_preview(message), 240),
                "tokens": _token_usage(message),
            },
            duration_ms=int((time.time() - start) * 1000),
        )

    # ----- tool calls (deepagents tools + sub-agent handoffs) -----
    def wrap_tool_call(self, request, handler: Callable) -> Any:
        run, tool_name = self._before_tool_call(request)
        start = time.time()
        try:
            result = handler(request)
        except Exception as exc:
            self._emit_tool_error(run, tool_name, exc)
            raise
        self._emit_tool_result(run, tool_name, result, start)
        return result

    async def awrap_tool_call(self, request, handler: Callable) -> Any:
        run, tool_name = self._before_tool_call(request)
        start = time.time()
        try:
            result = await handler(request)
        except Exception as exc:
            self._emit_tool_error(run, tool_name, exc)
            raise
        self._emit_tool_result(run, tool_name, result, start)
        return result

    def _before_tool_call(self, request) -> tuple[ActiveRun, str]:
        run = self._ensure_run()
        tool_call = getattr(request, "tool_call", {}) or {}
        tool_name = tool_call.get("name", "tool")
        tool_args = tool_call.get("args", {})

        run.emit(
            source=self.orchestrator,
            target=tool_name,
            type="tool_call",
            label=f"{tool_name}({truncate(str(tool_args), LABEL_LIMIT)})",
            payload={"args": compact(tool_args)},
        )

        if any(marker in tool_name.lower() for marker in HANDOFF_MARKERS):
            sub_agent = _extract_handoff_target(tool_args) or "Sub-agent"
            run.emit(
                source=self.orchestrator,
                target=sub_agent,
                type="handoff",
                label=f"delegate → {sub_agent}",
                payload={"task": compact(tool_args, 200)},
            )
        return run, tool_name

    def _emit_tool_result(self, run: ActiveRun, tool_name: str, result: Any, start: float) -> None:
        run.emit(
            source=tool_name,
            target=self.orchestrator,
            type="tool_result",
            label=f"{tool_name} → result",
            payload={"result": truncate(str(_result_content(result)), RESULT_LIMIT)},
            duration_ms=int((time.time() - start) * 1000),
        )

    def _emit_tool_error(self, run: ActiveRun, tool_name: str, exc: Exception) -> None:
        self._had_error = True
        run.emit(
            source=tool_name,
            target=self.orchestrator,
            type="error",
            label=f"{tool_name} failed",
            payload={"error": type(exc).__name__, "message": str(exc)},
            status="error",
        )


def _last_message_text(state) -> str:
    try:
        messages = state["messages"]
        content = messages[-1].content
        return content if isinstance(content, str) else str(content)
    except Exception:
        return ""


# Deprecated: the pre-0.3 name (AgentTrace was renamed LaneTrace). Same class.
AgentTraceMiddleware = LaneTraceMiddleware
