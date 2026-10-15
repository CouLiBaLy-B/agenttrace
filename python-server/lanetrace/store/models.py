"""SQLAlchemy models — 1:1 port of prisma/schema.prisma's Project/Run/Event/ApiKey.

User drops the NextAuth-specific Account/Session/VerificationToken tables
(replaced by the signed-cookie session in security.py) but keeps the same
email/passwordHash shape so existing user data could be migrated later.

`Run.metadata_` is named with a trailing underscore because `metadata` is
reserved by SQLAlchemy's declarative `Base` — the actual column name in the
database is still `metadata` (via `Column("metadata", ...)`).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import DeclarativeBase, relationship


def _id() -> str:
    return uuid.uuid4().hex


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=_id)
    email = Column(String, unique=True, nullable=False, index=True)
    name = Column(String, nullable=True)
    password_hash = Column("passwordHash", String, nullable=True)
    created_at = Column("createdAt", DateTime(timezone=True), default=_now, nullable=False)
    updated_at = Column("updatedAt", DateTime(timezone=True), default=_now, onupdate=_now, nullable=False)

    projects = relationship("Project", back_populates="user", cascade="all, delete-orphan")


class Project(Base):
    __tablename__ = "projects"

    id = Column(String, primary_key=True, default=_id)
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    user_id = Column("userId", String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column("createdAt", DateTime(timezone=True), default=_now, nullable=False)
    updated_at = Column("updatedAt", DateTime(timezone=True), default=_now, onupdate=_now, nullable=False)

    user = relationship("User", back_populates="projects")
    runs = relationship("Run", back_populates="project", cascade="all, delete-orphan")
    api_keys = relationship("ApiKey", back_populates="project", cascade="all, delete-orphan")


class Run(Base):
    __tablename__ = "runs"

    id = Column(String, primary_key=True, default=_id)
    project_id = Column("projectId", String, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String, nullable=False)
    status = Column(String, nullable=False, default="running")  # running | completed | failed
    started_at = Column("startedAt", DateTime(timezone=True), default=_now, nullable=False)
    ended_at = Column("endedAt", DateTime(timezone=True), nullable=True)
    metadata_ = Column("metadata", String, nullable=True)

    project = relationship("Project", back_populates="runs")
    events = relationship("Event", back_populates="run", cascade="all, delete-orphan", order_by="Event.seq")


class Event(Base):
    __tablename__ = "events"

    id = Column(String, primary_key=True, default=_id)
    run_id = Column("runId", String, ForeignKey("runs.id", ondelete="CASCADE"), nullable=False, index=True)
    timestamp = Column(DateTime(timezone=True), default=_now, nullable=False)
    seq = Column(Integer, nullable=False, default=0)
    source = Column(String, nullable=False)
    target = Column(String, nullable=False)
    type = Column(String, nullable=False)  # llm_call | tool_call | tool_result | handoff | error | final_answer
    label = Column(String, nullable=True)
    payload = Column(String, nullable=False, default="{}")  # JSON string
    duration_ms = Column("durationMs", Integer, nullable=True)
    status = Column(String, nullable=False, default="ok")  # ok | error | pending

    run = relationship("Run", back_populates="events")


class ApiKey(Base):
    __tablename__ = "api_keys"

    id = Column(String, primary_key=True, default=_id)
    project_id = Column("projectId", String, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    key_hash = Column("keyHash", String, unique=True, nullable=False, index=True)
    prefix = Column(String, nullable=False)
    label = Column(String, nullable=True)
    created_at = Column("createdAt", DateTime(timezone=True), default=_now, nullable=False)
    last_used_at = Column("lastUsedAt", DateTime(timezone=True), nullable=True)

    project = relationship("Project", back_populates="api_keys")
