"""Engine/session factories shared by the server and the SDK.

The server used to build one module-level engine from DATABASE_URL. The SDK
needs to target whatever tracking URI the user picked (MLflow-style), so
engines are cached per URL instead. SQLite gets a 30 s busy timeout because
the SDK and `agenttrace ui` routinely hold the same file open from two
processes.
"""

from __future__ import annotations

import os
import threading

from sqlalchemy import Engine, create_engine
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import sessionmaker

DEFAULT_SQLITE_URL = "sqlite:///./agenttrace.db"

_lock = threading.Lock()
_engines: dict[str, Engine] = {}
_sessionmakers: dict[str, sessionmaker] = {}
_init_lock = threading.Lock()
_initialized: set[str] = set()


def database_url() -> str:
    return os.getenv("DATABASE_URL", DEFAULT_SQLITE_URL)


def get_engine(url: str) -> Engine:
    with _lock:
        engine = _engines.get(url)
        if engine is None:
            connect_args = {"check_same_thread": False, "timeout": 30} if url.startswith("sqlite") else {}
            engine = create_engine(url, connect_args=connect_args)
            _engines[url] = engine
        return engine


def get_sessionmaker(url: str) -> sessionmaker:
    engine = get_engine(url)
    with _lock:
        factory = _sessionmakers.get(url)
        if factory is None:
            factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
            _sessionmakers[url] = factory
        return factory


def init_db(url: str) -> None:
    """Create all tables if they don't exist yet (schema-push style).

    Once per URL per process, under a lock: concurrent first runs would
    otherwise race `create_all` (check-then-create) and lose writes to
    "table already exists". Another *process* can still win that race, so
    that error is retried once (the second pass sees the tables)."""
    from . import models

    with _init_lock:
        if url in _initialized:
            return
        engine = get_engine(url)
        try:
            models.Base.metadata.create_all(bind=engine)
        except OperationalError as exc:
            if "already exists" not in str(exc):
                raise
            models.Base.metadata.create_all(bind=engine)
        _initialized.add(url)
