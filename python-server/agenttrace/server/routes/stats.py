"""Port of src/app/api/stats/route.ts — dashboard home stats for the current user."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models
from ..db import get_db
from ..deps import require_user

router = APIRouter(prefix="/api/stats", tags=["stats"])


@router.get("")
def stats(user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    projects = db.query(models.Project).filter(models.Project.user_id == user.id).all()
    project_ids = [p.id for p in projects]

    runs = (
        db.query(models.Run)
        .filter(models.Run.project_id.in_(project_ids))
        .order_by(models.Run.started_at.desc())
        .all()
        if project_ids
        else []
    )

    total_runs = len(runs)
    completed = sum(1 for r in runs if r.status == "completed")
    failed = sum(1 for r in runs if r.status == "failed")
    success_rate = round((completed / total_runs) * 100) if total_runs else 0

    finished = [r for r in runs if r.ended_at]
    avg_ms = (
        round(sum((r.ended_at - r.started_at).total_seconds() * 1000 for r in finished) / len(finished))
        if finished
        else 0
    )

    run_ids = [r.id for r in runs]
    total_events = (
        (db.query(func.count(models.Event.id)).filter(models.Event.run_id.in_(run_ids)).scalar() or 0) if run_ids else 0
    )
    event_counts = (
        dict(
            db.query(models.Event.run_id, func.count(models.Event.id))
            .filter(models.Event.run_id.in_([r.id for r in runs[:8]]))
            .group_by(models.Event.run_id)
            .all()
        )
        if runs
        else {}
    )

    projects_by_id = {p.id: p for p in projects}
    per_project = []
    for p in projects:
        p_runs = [r for r in runs if r.project_id == p.id]
        p_completed = sum(1 for r in p_runs if r.status == "completed")
        per_project.append(
            {
                "id": p.id,
                "name": p.name,
                "description": p.description,
                "runs": len(p_runs),
                "successRate": round((p_completed / len(p_runs)) * 100) if p_runs else 0,
                "lastRunAt": p_runs[0].started_at.isoformat() if p_runs else None,
            }
        )

    recent = [
        {
            "id": r.id,
            "name": r.name,
            "status": r.status,
            "startedAt": r.started_at.isoformat(),
            "endedAt": r.ended_at.isoformat() if r.ended_at else None,
            "durationMs": int((r.ended_at - r.started_at).total_seconds() * 1000) if r.ended_at else None,
            "events": event_counts.get(r.id, 0),
            "project": {"id": r.project_id, "name": projects_by_id[r.project_id].name},
        }
        for r in runs[:8]
    ]

    type_dist: dict[str, int] = (
        dict(
            db.query(models.Event.type, func.count(models.Event.id))
            .filter(models.Event.run_id.in_(run_ids))
            .group_by(models.Event.type)
            .all()
        )
        if run_ids
        else {}
    )

    return {
        "totalProjects": len(projects),
        "totalRuns": total_runs,
        "completed": completed,
        "failed": failed,
        "successRate": success_rate,
        "avgMs": avg_ms,
        "totalEvents": total_events,
        "perProject": per_project,
        "recent": recent,
        "typeDist": type_dist,
    }
