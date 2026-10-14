"""GET /api/timeline — runs of the last N hours grouped by project, for the
dashboard chronogram (and a single project's, with ?projectId=)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from .. import models
from ..db import get_db
from ..deps import require_user
from ..serializers import _iso

router = APIRouter(prefix="/api/timeline", tags=["timeline"])

MAX_RUNS = 500


@router.get("")
def timeline(
    hours: int = Query(24, ge=1, le=168),
    projectId: Optional[str] = None,
    user: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    start = now - timedelta(hours=hours)
    projects_q = db.query(models.Project).filter(models.Project.user_id == user.id)
    if projectId:
        projects_q = projects_q.filter(models.Project.id == projectId)
    projects = projects_q.order_by(models.Project.created_at).all()
    if projectId and not projects:
        raise HTTPException(status_code=404, detail={"error": "Project not found"})

    ids = [p.id for p in projects]
    runs = (
        db.query(models.Run)
        .filter(models.Run.project_id.in_(ids), or_(models.Run.started_at >= start, models.Run.status == "running"))
        .order_by(models.Run.started_at.desc())
        .limit(MAX_RUNS + 1)
        .all()
        if ids
        else []
    )
    truncated = len(runs) > MAX_RUNS
    runs = runs[:MAX_RUNS]
    counts = dict(
        db.query(models.Event.run_id, func.count(models.Event.id))
        .filter(models.Event.run_id.in_([r.id for r in runs]))
        .group_by(models.Event.run_id)
        .all()
    ) if runs else {}

    by_project: dict[str, list] = {p.id: [] for p in projects}
    for r in sorted(runs, key=lambda r: r.started_at):
        by_project[r.project_id].append({
            "id": r.id, "name": r.name, "status": r.status,
            "startedAt": _iso(r.started_at), "endedAt": _iso(r.ended_at), "eventCount": counts.get(r.id, 0),
        })
    return {
        "from": _iso(start), "to": _iso(now), "truncated": truncated,
        "projects": [{"id": p.id, "name": p.name, "runs": by_project[p.id]} for p in projects],
    }
