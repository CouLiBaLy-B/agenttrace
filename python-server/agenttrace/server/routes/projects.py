"""Port of src/app/api/projects/route.ts and src/app/api/projects/[id]/route.ts."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models
from ..db import get_db
from ..deps import require_user
from ..security import generate_api_key, hash_api_key, key_prefix
from ..serializers import project_detail_out, project_out

router = APIRouter(prefix="/api/projects", tags=["projects"])


class CreateProjectBody(BaseModel):
    name: str = ""
    description: str = ""


class UpdateProjectBody(BaseModel):
    name: str | None = None
    description: str | None = None


@router.get("")
def list_projects(user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    projects = (
        db.query(models.Project)
        .filter(models.Project.user_id == user.id)
        .order_by(models.Project.created_at.desc())
        .all()
    )
    result = []
    for p in projects:
        run_count = db.query(func.count(models.Run.id)).filter(models.Run.project_id == p.id).scalar()
        latest = (
            db.query(models.Run)
            .filter(models.Run.project_id == p.id)
            .order_by(models.Run.started_at.desc())
            .limit(1)
            .all()
        )
        result.append(project_out(p, run_count=run_count, latest_runs=latest))
    return {"projects": result}


@router.post("", status_code=201)
def create_project(
    body: CreateProjectBody, user: models.User = Depends(require_user), db: Session = Depends(get_db)
):
    name = body.name.strip()
    description = body.description.strip()
    if not name:
        raise HTTPException(status_code=400, detail={"error": "Name is required"})

    project = models.Project(name=name, description=description or None, user_id=user.id)
    db.add(project)
    db.flush()

    raw_key = generate_api_key()
    db.add(
        models.ApiKey(
            project_id=project.id,
            key_hash=hash_api_key(raw_key),
            prefix=key_prefix(raw_key),
            label="Default key",
        )
    )
    db.commit()
    db.refresh(project)

    return {"project": project_out(project), "apiKey": raw_key}


def _get_owned_project(db: Session, project_id: str, user_id: str) -> models.Project:
    project = db.get(models.Project, project_id)
    if not project or project.user_id != user_id:
        raise HTTPException(status_code=404, detail={"error": "Not found"})
    return project


@router.get("/{project_id}")
def get_project(project_id: str, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    project = _get_owned_project(db, project_id, user.id)
    return {"project": project_detail_out(project)}


@router.patch("/{project_id}")
def update_project(
    project_id: str,
    body: UpdateProjectBody,
    user: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    project = _get_owned_project(db, project_id, user.id)
    if body.name and body.name.strip():
        project.name = body.name.strip()
    if body.description is not None:
        project.description = body.description.strip() or None
    db.commit()
    db.refresh(project)
    return {"project": project_out(project)}


@router.delete("/{project_id}")
def delete_project(project_id: str, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    project = _get_owned_project(db, project_id, user.id)
    db.delete(project)
    db.commit()
    return {"ok": True}
