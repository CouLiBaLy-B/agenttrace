"""Port of src/app/api/projects/[id]/runs/route.ts, src/app/api/runs/[id]/route.ts
and src/app/api/runs/[id]/events/route.ts."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import models
from ..db import get_db
from ..deps import require_user
from ..serializers import event_out, run_detail_out, run_out

project_runs_router = APIRouter(prefix="/api/projects/{project_id}/runs", tags=["runs"])
runs_router = APIRouter(prefix="/api/runs", tags=["runs"])


class CreateRunBody(BaseModel):
    name: str = "Untitled run"


class UpdateRunBody(BaseModel):
    name: str | None = None
    status: str | None = None  # running | completed | failed


def _get_owned_project(db: Session, project_id: str, user_id: str) -> models.Project:
    project = db.get(models.Project, project_id)
    if not project or project.user_id != user_id:
        raise HTTPException(status_code=404, detail={"error": "Not found"})
    return project


def _get_owned_run(db: Session, run_id: str, user_id: str) -> models.Run:
    run = db.get(models.Run, run_id)
    if not run or run.project.user_id != user_id:
        raise HTTPException(status_code=404, detail={"error": "Not found"})
    return run


@project_runs_router.get("")
def list_project_runs(project_id: str, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    _get_owned_project(db, project_id, user.id)
    runs = (
        db.query(models.Run)
        .filter(models.Run.project_id == project_id)
        .order_by(models.Run.started_at.desc())
        .all()
    )
    return {"runs": [run_out(r, event_count=len(r.events)) for r in runs]}


@project_runs_router.post("", status_code=201)
def create_run(
    project_id: str,
    body: CreateRunBody,
    user: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    _get_owned_project(db, project_id, user.id)
    run = models.Run(project_id=project_id, name=body.name.strip() or "Untitled run", status="running")
    db.add(run)
    db.commit()
    db.refresh(run)
    return {"run": run_out(run, event_count=0)}


@runs_router.get("/{run_id}")
def get_run(run_id: str, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    run = _get_owned_run(db, run_id, user.id)
    return {"run": run_detail_out(run)}


@runs_router.patch("/{run_id}")
def update_run(
    run_id: str, body: UpdateRunBody, user: models.User = Depends(require_user), db: Session = Depends(get_db)
):
    run = _get_owned_run(db, run_id, user.id)
    if body.name and body.name.strip():
        run.name = body.name.strip()
    if body.status in ("completed", "failed", "running"):
        run.status = body.status
        run.ended_at = None if body.status == "running" else datetime.now(timezone.utc)
    db.commit()
    db.refresh(run)
    return {"run": run_out(run, event_count=len(run.events))}


@runs_router.delete("/{run_id}")
def delete_run(run_id: str, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    run = _get_owned_run(db, run_id, user.id)
    db.delete(run)
    db.commit()
    return {"ok": True}


@runs_router.get("/{run_id}/events")
def list_run_events(run_id: str, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    run = _get_owned_run(db, run_id, user.id)
    return {"events": [event_out(e) for e in sorted(run.events, key=lambda e: e.seq)]}
