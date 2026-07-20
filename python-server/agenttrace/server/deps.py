"""FastAPI dependencies for the two auth mechanisms already used by the
Next.js backend: session cookie (dashboard UI) vs project API key (ingestion).

Mirrors src/lib/session.ts (`requireUser`) and src/lib/api-auth.ts
(`authenticateApiKey`), including the exact error strings, so behavior is a
drop-in match.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from . import models
from .db import get_db
from .security import SESSION_COOKIE_NAME, hash_api_key, read_session_token


def require_user(request: Request, db: Session = Depends(get_db)) -> models.User:
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
