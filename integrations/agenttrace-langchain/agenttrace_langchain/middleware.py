"""AgentTraceMiddleware — streams a deepagents/LangChain agent run to
AgentTrace as a live sequence diagram.

Maps `AgentMiddleware` hooks (`langchain.agents.middleware`, LangChain's 2026
middleware system) onto AgentTrace event types:

    before_agent    -> create the AgentTrace run
    wrap_model_call -> emit `llm_call` (Orchestrator -> LLM)
    wrap_tool_call  -> emit `tool_call` / `tool_result` / `error` / `handoff`
    after_agent     -> emit `final_answer` and close the run

Sync and async variants (`wrap_tool_call`/`awrap_tool_call`, etc.) are both
implemented so the middleware behaves identically whether the agent is driven
via `.invoke()` or `.ainvoke()`.

Built on `AgentTraceRun` (run.py): emission is non-blocking (a background
thread drains a queue) and never fatal — a misconfigured or unreachable
AgentTrace instance disables tracing for the run (one warning logged) instead
of breaking the agent. One middleware instance = one AgentTrace run:

    agent = create_deep_agent(
        model=model,
        tools=[...],
        middleware=[AgentTraceMiddleware(run_name="research run")],
    )
"""

from __future__ import annotations

import logging
import time
from typing import Any, Callable, Optional

from langchain.agents.middleware import AgentMiddleware

from .client import AgentTraceClient
from .run import ANSWER_LIMIT, LABEL_LIMIT, RESULT_LIMIT, AgentTraceRun, compact, truncate

logger = logging.getLogger(__name__)

_HANDOFF_MARKERS = ("handoff", "delegate")


class AgentTraceMiddleware(AgentMiddleware):
    def __init__(
        self,
        run_name: str = "deepagents run",
        orchestrator: str = "Orchestrator",
        url: Optional[str] = None,
        api_key: Optional[str] = None,
        timeout: float = 10.0,
    ):
        super().__init__()
        self.run_name = run_name
        self.orchestrator = orchestrator
        self._client_kwargs = {"url": url, "api_key": api_key, "timeout": timeout}
        self._run: Optional[AgentTraceRun] = None
        self._had_error = False

    def _ensure_run(self) -> AgentTraceRun:
        if self._run is None:
            self._run = AgentTraceRun(self.run_name, client=AgentTraceClient(**self._client_kwargs))
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
        self, run: AgentTraceRun, model_name: str, request: Any, response: Any, start: float
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

    def _before_tool_call(self, request) -> tuple[AgentTraceRun, str]:
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

        if any(marker in tool_name.lower() for marker in _HANDOFF_MARKERS):
            sub_agent = _extract_handoff_target(tool_args) or "Sub-agent"
            run.emit(
                source=self.orchestrator,
                target=sub_agent,
                type="handoff",
                label=f"delegate → {sub_agent}",
                payload={"task": compact(tool_args, 200)},
            )
        return run, tool_name

    def _emit_tool_result(self, run: AgentTraceRun, tool_name: str, result: Any, start: float) -> None:
        run.emit(
            source=tool_name,
            target=self.orchestrator,
            type="tool_result",
            label=f"{tool_name} → result",
            payload={"result": truncate(str(_result_content(result)), RESULT_LIMIT)},
            duration_ms=int((time.time() - start) * 1000),
        )

    def _emit_tool_error(self, run: AgentTraceRun, tool_name: str, exc: Exception) -> None:
        self._had_error = True
        run.emit(
            source=tool_name,
            target=self.orchestrator,
            type="error",
            label=f"{tool_name} failed",
            payload={"error": type(exc).__name__, "message": str(exc)},
            status="error",
        )


def _model_name(request) -> str:
    model = getattr(request, "model", None)
    name = getattr(model, "model", None) or getattr(model, "model_name", None)
    return str(name) if name else "LLM"


def _content_to_text(content: Any) -> str:
    """Flatten LangChain message content to plain text. `content` is either a
    string or a list of content blocks (`[{"type": "text", "text": "..."}]`,
    the shape deepagents/most chat models use for system/human messages) —
    naively `str()`-ing the list would dump Python-repr noise instead of the
    actual text."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict) and block.get("text"):
                parts.append(str(block["text"]))
        return "".join(parts) if parts else str(content)
    return str(content)


def _message_dict(message: Any, limit: int = RESULT_LIMIT) -> dict[str, Any]:
    role = getattr(message, "type", None) or type(message).__name__
    content = getattr(message, "content", message)
    return {"role": role, "content": truncate(_content_to_text(content), limit)}


def _messages_preview(request: Any) -> dict[str, Any]:
    """The full input to this LLM call: system prompt (if any) + the
    conversation messages sent, as `ModelRequest` exposes them. Each field is
    truncated on its own (not the payload as a whole) so a huge, mostly-
    unchanging system prompt can't crowd out the actual conversation turns —
    or worse, get cut mid-JSON by a global length cap."""
    system_message = getattr(request, "system_message", None)
    messages = getattr(request, "messages", None) or []
    preview: dict[str, Any] = {"messages": [_message_dict(m) for m in messages]}
    if system_message is not None:
        preview["system"] = truncate(_content_to_text(getattr(system_message, "content", system_message)), LABEL_LIMIT * 4)
    return preview


def _last_model_message(response) -> Any:
    """Unwrap a `ModelResponse` (`.result: list[BaseMessage]`) to its last
    message. Falls back to `response` itself if it isn't a ModelResponse
    (e.g. a bare AIMessage, as some tests/middleware hand back directly)."""
    result = getattr(response, "result", None)
    if isinstance(result, list) and result:
        return result[-1]
    return response


def _response_preview(response) -> str:
    content = _result_content(response)
    return content if isinstance(content, str) else str(content)


def _result_content(result) -> Any:
    for attr in ("content", "result", "text"):
        value = getattr(result, attr, None)
        if value is not None:
            return value
    return result


def _token_usage(response) -> Optional[dict]:
    for attr in ("usage_metadata", "response_metadata"):
        value = getattr(response, attr, None)
        if value:
            return value
    return None


def _extract_handoff_target(tool_args: dict) -> Optional[str]:
    if isinstance(tool_args, dict):
        return tool_args.get("to") or tool_args.get("name") or tool_args.get("agent")
    return None


def _last_message_text(state) -> str:
    try:
        messages = state["messages"]
        content = messages[-1].content
        return content if isinstance(content, str) else str(content)
    except Exception:
        return ""
