"""Port of src/app/api/keys/route.ts and src/app/api/keys/[id]/route.ts."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import models
from ..db import get_db
from ..deps import require_user
from ..security import generate_api_key, hash_api_key, key_prefix
from ..serializers import key_out

router = APIRouter(prefix="/api/keys", tags=["keys"])


class CreateKeyBody(BaseModel):
    projectId: str
    label: str | None = None


def _get_owned_project(db: Session, project_id: str, user_id: str) -> models.Project:
    project = db.get(models.Project, project_id)
    if not project or project.user_id != user_id:
        raise HTTPException(status_code=404, detail={"error": "Not found"})
    return project


@router.get("")
def list_keys(projectId: str | None = None, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    if not projectId:
        raise HTTPException(status_code=400, detail={"error": "projectId required"})
    _get_owned_project(db, projectId, user.id)
    keys = (
        db.query(models.ApiKey)
        .filter(models.ApiKey.project_id == projectId)
        .order_by(models.ApiKey.created_at.desc())
        .all()
    )
    return {"keys": [key_out(k) for k in keys]}


@router.post("", status_code=201)
def create_key(body: CreateKeyBody, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    _get_owned_project(db, body.projectId, user.id)
    raw_key = generate_api_key()
    key = models.ApiKey(
        project_id=body.projectId,
        key_hash=hash_api_key(raw_key),
        prefix=key_prefix(raw_key),
        label=body.label or "Default key",
    )
    db.add(key)
    db.commit()
    db.refresh(key)
    return {"key": key_out(key), "rawKey": raw_key}


@router.delete("/{key_id}")
def delete_key(
    key_id: str,
    projectId: str | None = None,
    user: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    if not projectId:
        raise HTTPException(status_code=400, detail={"error": "projectId required"})
    _get_owned_project(db, projectId, user.id)
    db.query(models.ApiKey).filter(
        models.ApiKey.id == key_id, models.ApiKey.project_id == projectId
    ).delete()
    db.commit()
    return {"ok": True}
