"""Tracking URI resolution, MLflow-style: explicit `set_tracking_uri()` >
AGENTTRACE_TRACKING_URI > legacy AGENTTRACE_URL (the full `/api/events` URL
the pre-0.2 client used) > `http://localhost:3000` when only AGENTTRACE_KEY is
set (the pre-0.2 client's default server, so those setups keep posting there
instead of silently switching to SQLite) > local SQLite file."""

from __future__ import annotations

import logging
import os
from typing import Optional

DEFAULT_TRACKING_URI = "sqlite:///./agenttrace.db"
_EVENTS_PATH = "/api/events"

LEGACY_DEFAULT_URI = "http://localhost:3000"

_log = logging.getLogger(__name__)
_tracking_uri: Optional[str] = None
_legacy_logged = False


def set_tracking_uri(uri: Optional[str]) -> None:
    global _tracking_uri
    _tracking_uri = uri or None


def get_tracking_uri() -> str:
    if _tracking_uri:
        return _tracking_uri
    env = os.getenv("AGENTTRACE_TRACKING_URI")
    if env:
        return env
    legacy = os.getenv("AGENTTRACE_URL")
    if legacy:
        return legacy.rstrip("/").removesuffix(_EVENTS_PATH)
    if os.getenv("AGENTTRACE_KEY"):
        global _legacy_logged
        if not _legacy_logged:
            _legacy_logged = True
            _log.warning(
                "AgentTrace: only AGENTTRACE_KEY is set — sending to %s (pre-0.2 default). "
                "Set AGENTTRACE_TRACKING_URI to choose explicitly.",
                LEGACY_DEFAULT_URI,
            )
        return LEGACY_DEFAULT_URI
    return DEFAULT_TRACKING_URI


def is_http_uri(uri: str) -> bool:
    return uri.lower().startswith(("http://", "https://"))


def events_url(uri: str) -> str:
    base = uri.rstrip("/")
    return base if base.endswith(_EVENTS_PATH) else base + _EVENTS_PATH
