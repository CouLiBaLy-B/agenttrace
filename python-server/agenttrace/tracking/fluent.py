"""Module-level tracking API, MLflow-style (`agenttrace.start_run()` etc.).

The active-run stack lives in a ContextVar holding an immutable tuple, so
each thread and asyncio task sees its own current run. `log_event()`/`@trace`
with no active run start one implicit run per process (like MLflow), ended
by `end_run()` or at interpreter exit.
"""

from __future__ import annotations

import functools
import inspect
import logging
import os
import reprlib
import threading
import time
from contextvars import ContextVar
from datetime import datetime
from typing import Any, Callable, Optional

from ._uri import get_tracking_uri
from .run import LABEL_LIMIT, RESULT_LIMIT, ActiveRun, compact, truncate
from .stores import store_for_uri

DEFAULT_PROJECT = "Default"

_log = logging.getLogger(__name__)
# Bounded repr: huge or self-referencing arguments must not cost the caller.
_bounded = reprlib.Repr()
_bounded.maxstring = _bounded.maxother = LABEL_LIMIT
_bounded.maxlevel, _bounded.maxlist, _bounded.maxdict = 3, 6, 6

_project: Optional[str] = None
_active_runs: ContextVar[tuple[ActiveRun, ...]] = ContextVar("agenttrace_active_runs", default=())
_implicit_run: Optional[ActiveRun] = None
_implicit_lock = threading.Lock()


def set_project(name: Optional[str]) -> None:
    global _project
    _project = name or None


def get_project() -> str:
    return _project or os.getenv("AGENTTRACE_PROJECT") or DEFAULT_PROJECT


def _default_run_name() -> str:
    return f"run {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"


def _forget(run: ActiveRun) -> None:
    global _implicit_run
    _active_runs.set(tuple(r for r in _active_runs.get() if r is not run))
    with _implicit_lock:
        if _implicit_run is run:
            _implicit_run = None


def _new_run(name: Optional[str], project: Optional[str]) -> ActiveRun:
    return ActiveRun(
        store_for_uri(get_tracking_uri()),
        name or _default_run_name(),
        project=project or get_project(),
        on_end=_forget,
    )


def start_run(name: Optional[str] = None, *, project: Optional[str] = None) -> ActiveRun:
    run = _new_run(name, project)
    _active_runs.set(_active_runs.get() + (run,))
    return run


def active_run() -> Optional[ActiveRun]:
    stack = _active_runs.get()
    if stack:
        return stack[-1]
    return _implicit_run


def _current_or_implicit_run() -> ActiveRun:
    global _implicit_run
    run = active_run()
    if run is not None:
        return run
    with _implicit_lock:
        if _implicit_run is None:
            _implicit_run = _new_run(None, None)
        return _implicit_run


def end_run(status: str = "completed") -> None:
    run = active_run()
    if run is not None:
        run.end(status)
        run.close()


def log_event(
    *,
    source: str,
    target: str,
    type: str,
    label: Optional[str] = None,
    payload: Optional[dict] = None,
    duration_ms: Optional[int] = None,
    status: Optional[str] = None,
) -> None:
    _current_or_implicit_run().log_event(
        source=source, target=target, type=type, label=label, payload=payload, duration_ms=duration_ms, status=status
    )


def trace(fn: Optional[Callable] = None, *, target: Optional[str] = None, source: str = "Orchestrator"):
    """Decorator emitting tool_call -> tool_result | error around a function (sync or async)."""

    def decorate(func: Callable) -> Callable:
        name = target or func.__name__

        def safely(step: Callable[[], Any]) -> Any:
            # Tracing must never break the traced function.
            try:
                return step()
            except Exception:
                _log.debug("agenttrace: tracing step failed", exc_info=True)
                return None

        def before(args: tuple, kwargs: dict) -> Optional[tuple[ActiveRun, float]]:
            def step() -> tuple[ActiveRun, float]:
                run = _current_or_implicit_run()
                arg_text = ", ".join([_bounded.repr(a) for a in args] + [f"{k}={_bounded.repr(v)}" for k, v in kwargs.items()])
                run.log_event(
                    source=source,
                    target=name,
                    type="tool_call",
                    label=f"{name}({truncate(arg_text, LABEL_LIMIT)})",
                    payload={"args": compact(list(args)), "kwargs": compact(kwargs)},
                )
                return run, time.monotonic()

            return safely(step)

        def after(ctx: Optional[tuple[ActiveRun, float]], result: Any) -> None:
            if ctx is None:
                return
            run, started = ctx
            safely(
                lambda: run.log_event(
                    source=name,
                    target=source,
                    type="tool_result",
                    label=f"{name} → result",
                    payload={"result": compact(result, RESULT_LIMIT)},
                    duration_ms=int((time.monotonic() - started) * 1000),
                )
            )

        def failed(ctx: Optional[tuple[ActiveRun, float]], exc: BaseException) -> None:
            if ctx is None:
                return
            run, _ = ctx
            safely(
                lambda: run.log_event(
                    source=name,
                    target=source,
                    type="error",
                    label=f"{name} failed",
                    payload={"error": type(exc).__name__, "message": str(exc)},
                    status="error",
                )
            )

        if inspect.iscoroutinefunction(func):

            @functools.wraps(func)
            async def async_wrapper(*args, **kwargs):
                ctx = before(args, kwargs)
                try:
                    result = await func(*args, **kwargs)
                except Exception as exc:
                    failed(ctx, exc)
                    raise
                after(ctx, result)
                return result

            return async_wrapper

        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            ctx = before(args, kwargs)
            try:
                result = func(*args, **kwargs)
            except Exception as exc:
                failed(ctx, exc)
                raise
            after(ctx, result)
            return result

        return wrapper

    return decorate(fn) if fn is not None else decorate


def _reset_for_tests() -> None:
    """End every run this module knows about and clear global state."""
    global _project
    for run in list(_active_runs.get()):
        run.end()
        run.close()
    _active_runs.set(())
    end_run()
    _project = None
