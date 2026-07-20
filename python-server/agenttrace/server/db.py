"""Database engine/session setup.

Mirrors the two profiles already documented for the Next.js backend
(DATABASE_URL for Postgres, or a local file for SQLite) — same env var, same
"schema push" workflow (`agenttrace db init` == `prisma db push`, no
migration history) rather than Alembic, to keep parity with how this repo
already runs locally (see README "Database profiles").

Zero-config default: a local `agenttrace.db` SQLite file, so `agenttrace ui`
works immediately after `pip install` with no external database required —
this is the `mlflow ui`-style zero-friction default.
"""

from __future__ import annotations

import os
from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

DEFAULT_SQLITE_URL = "sqlite:///./agenttrace.db"


def _database_url() -> str:
    return os.getenv("DATABASE_URL", DEFAULT_SQLITE_URL)


def _make_engine():
    url = _database_url()
    connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
    return create_engine(url, connect_args=connect_args)


engine = _make_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """Create all tables if they don't exist yet (schema-push style)."""
    from . import models  # noqa: F401 - ensure models are registered on Base.metadata

    models.Base.metadata.create_all(bind=engine)
