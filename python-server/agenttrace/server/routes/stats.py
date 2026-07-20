"""Port of src/app/api/stats/route.ts — dashboard home stats for the current user."""

from __future__ import annotations

from fastapi import APIRouter, Depends
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

    total_events = sum(len(r.events) for r in runs)

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
            "events": len(r.events),
            "project": {"id": r.project_id, "name": projects_by_id[r.project_id].name},
        }
        for r in runs[:8]
    ]

    type_dist: dict[str, int] = {}
    for r in runs:
        for e in r.events:
            type_dist[e.type] = type_dist.get(e.type, 0) + 1

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
