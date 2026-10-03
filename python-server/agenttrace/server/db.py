"""Database engine/session setup.

Mirrors the two profiles already documented for the Next.js backend
(DATABASE_URL for Postgres, or a local file for SQLite) — same env var, same
"schema push" workflow (`agenttrace db init` == `prisma db push`, no
migration history) rather than Alembic, to keep parity with how this repo
already runs locally (see README "Database profiles").

Zero-config default: a local `agenttrace.db` SQLite file, so `agenttrace ui`
works immediately after `pip install` with no external database required —
this is the `mlflow ui`-style zero-friction default.

Engines now come from `agenttrace.store.db`, cached per URL.
"""

from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy.orm import Session

from ..store.db import DEFAULT_SQLITE_URL, database_url, get_engine, get_sessionmaker  # noqa: F401
from ..store.db import init_db as _init_db

engine = get_engine(database_url())
SessionLocal = get_sessionmaker(database_url())


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """Create all tables if they don't exist yet (schema-push style)."""
    _init_db(database_url())
