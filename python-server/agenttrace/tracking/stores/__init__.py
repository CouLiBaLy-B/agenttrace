"""Tracking stores and the URI -> store factory."""

from __future__ import annotations

import os

from .._uri import events_url, is_http_uri
from .base import TrackingStore
from .rest import RestStore
from .sql import SqlStore

__all__ = ["RestStore", "SqlStore", "TrackingStore", "store_for_uri"]


def store_for_uri(uri: str) -> TrackingStore:
    if is_http_uri(uri):
        return RestStore(events_url(uri), api_key=os.getenv("AGENTTRACE_KEY"))
    return SqlStore(uri)
