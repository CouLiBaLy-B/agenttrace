"""FastAPI dependencies for the two auth mechanisms already used by the
Next.js backend: session cookie (dashboard UI) vs project API key (ingestion).

Mirrors src/lib/session.ts (`requireUser`) and src/lib/api-auth.ts
(`authenticateApiKey`), including the exact error strings, so behavior is a
drop-in match.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ..store.local import get_or_create_local_user
from . import models
from .db import get_db
from .security import SESSION_COOKIE_NAME, hash_api_key, read_session_token


def auth_mode() -> str:
    """`none` (local, no login, MLflow-style) or `password` (accounts + keys).
    Read per request so tests and the CLI can switch it via the environment."""
    return "none" if os.getenv("AGENTTRACE_AUTH") == "none" else "password"


def require_user(request: Request, db: Session = Depends(get_db)) -> models.User:
    if auth_mode() == "none":
        return get_or_create_local_user(db)
    token = request.cookies.get(SESSION_COOKIE_NAME)
    user_id = read_session_token(token) if token else None
    if not user_id:
        raise HTTPException(status_code=401, detail={"error": "Unauthorized"})
    user = db.get(models.User, user_id)
    if not user:
        raise HTTPException(status_code=401, detail={"error": "Unauthorized"})
    return user


def authenticate_api_key(request: Request, db: Session = Depends(get_db)) -> models.Project:
    auth_header = request.headers.get("authorization", "")
    token = auth_header[7:].strip() if auth_header.lower().startswith("bearer ") else auth_header.strip()
    if not token or not token.startswith("atr_"):
        raise HTTPException(status_code=401, detail={"error": "Missing or invalid API key"})

    key_hash = hash_api_key(token)
    api_key = db.query(models.ApiKey).filter(models.ApiKey.key_hash == key_hash).first()
    if not api_key:
        raise HTTPException(status_code=401, detail={"error": "Invalid API key"})

    api_key.last_used_at = datetime.now(timezone.utc)
    db.commit()

    project = db.get(models.Project, api_key.project_id)
    if not project:
        raise HTTPException(status_code=401, detail={"error": "Invalid API key"})
    return project


def ingest_project(request: Request, db: Session = Depends(get_db)) -> models.Project | None:
    """Project for `POST /api/events`: from the API key when one is sent,
    `None` (resolved later from the body's `project`) in keyless local mode."""
    if request.headers.get("authorization") or auth_mode() != "none":
        return authenticate_api_key(request, db)
    return None
