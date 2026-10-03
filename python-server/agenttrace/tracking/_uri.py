"""Tracking URI resolution, MLflow-style: explicit `set_tracking_uri()` >
AGENTTRACE_TRACKING_URI > legacy AGENTTRACE_URL (the full `/api/events` URL
the pre-0.2 client used) > local SQLite file."""

from __future__ import annotations

import os
from typing import Optional

DEFAULT_TRACKING_URI = "sqlite:///./agenttrace.db"
_EVENTS_PATH = "/api/events"

_tracking_uri: Optional[str] = None


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
    return DEFAULT_TRACKING_URI


def is_http_uri(uri: str) -> bool:
    return uri.lower().startswith(("http://", "https://"))


def events_url(uri: str) -> str:
    base = uri.rstrip("/")
    return base if base.endswith(_EVENTS_PATH) else base + _EVENTS_PATH
