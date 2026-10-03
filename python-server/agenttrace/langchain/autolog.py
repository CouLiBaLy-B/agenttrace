"""`agenttrace.langchain.autolog()` — trace every LangChain/deepagents
invocation in the process without touching agent code (MLflow-style).

LangChain consults hooks registered with `register_configure_hook` when it
builds each invocation's callback manager. The ContextVar's *default* is the
shared handler (not a value set in the current context), so invocations on
threads started anywhere — e.g. a FastAPI threadpool — are traced too.
Passing `handle_class` makes LangChain skip the hook when the caller already
attached an `AgentTraceCallbackHandler` explicitly, so nothing is traced twice.
`disable=True` flips the handler off instead of unregistering (LangChain has
no unregister API).
"""

from __future__ import annotations

import threading
from contextvars import ContextVar
from typing import Optional

from langchain_core.tracers.context import register_configure_hook

from .callback import AgentTraceCallbackHandler

_handler: Optional[AgentTraceCallbackHandler] = None
_lock = threading.Lock()


def autolog(disable: bool = False) -> None:
    global _handler
    with _lock:
        if _handler is None:
            if disable:
                return
            _handler = AgentTraceCallbackHandler()
            hook: ContextVar[Optional[AgentTraceCallbackHandler]] = ContextVar(
                "agenttrace_autolog_handler", default=_handler
            )
            register_configure_hook(hook, inheritable=True, handle_class=AgentTraceCallbackHandler)
        _handler.enabled = not disable
