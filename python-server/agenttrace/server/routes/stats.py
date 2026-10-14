"""Port of src/app/api/stats/route.ts — dashboard home stats for the current user.

Every aggregate is scoped by joining Run → Project (and Event → Run → Project) on
Project.user_id, never by an IN list of run ids: such a list grows with the data
(and Postgres caps bind parameters at 65,535), and building it means loading every run.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from .. import models
from ..db import get_db
from ..deps import require_user
from ..serializers import _iso

router = APIRouter(prefix="/api/stats", tags=["stats"])

RECENT_RUNS = 8


@router.get("")
def stats(user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    projects = db.query(models.Project).filter(models.Project.user_id == user.id).all()

    def user_runs(*columns):
        return db.query(*columns).join(models.Project, models.Run.project_id == models.Project.id).filter(
            models.Project.user_id == user.id
        )

    def user_events(*columns):
        return (
            db.query(*columns)
            .join(models.Run, models.Event.run_id == models.Run.id)
            .join(models.Project, models.Run.project_id == models.Project.id)
            .filter(models.Project.user_id == user.id)
        )

    completed_case = func.sum(case((models.Run.status == "completed", 1), else_=0))
    per_project_rows = {
        project_id: (count, completed or 0, last_start)
        for project_id, count, completed, last_start in user_runs(
            models.Run.project_id, func.count(models.Run.id), completed_case, func.max(models.Run.started_at)
        ).group_by(models.Run.project_id)
    }
    status_counts = dict(user_runs(models.Run.status, func.count(models.Run.id)).group_by(models.Run.status).all())

    total_runs = sum(status_counts.values())
    completed = status_counts.get("completed", 0)
    failed = status_counts.get("failed", 0)
    success_rate = round((completed / total_runs) * 100) if total_runs else 0

    # Column tuples only (no ORM objects): duration arithmetic stays in Python, portable across dialects.
    durations = [
        (ended - started).total_seconds() * 1000
        for started, ended in user_runs(models.Run.started_at, models.Run.ended_at).filter(models.Run.ended_at.isnot(None))
    ]
    avg_ms = round(sum(durations) / len(durations)) if durations else 0

    total_events = user_events(func.count(models.Event.id)).scalar() or 0
    type_dist: dict[str, int] = dict(user_events(models.Event.type, func.count(models.Event.id)).group_by(models.Event.type).all())

    recent_runs = (
        user_runs(models.Run)
        .order_by(models.Run.started_at.desc(), models.Run.id.desc())
        .limit(RECENT_RUNS)
        .all()
    )
    event_counts = (
        dict(
            db.query(models.Event.run_id, func.count(models.Event.id))
            .filter(models.Event.run_id.in_([r.id for r in recent_runs]))  # at most RECENT_RUNS ids
            .group_by(models.Event.run_id)
            .all()
        )
        if recent_runs
        else {}
    )

    projects_by_id = {p.id: p for p in projects}
    per_project = []
    for p in projects:
        p_runs, p_completed, last_start = per_project_rows.get(p.id, (0, 0, None))
        per_project.append(
            {
                "id": p.id,
                "name": p.name,
                "description": p.description,
                "runs": p_runs,
                "successRate": round((p_completed / p_runs) * 100) if p_runs else 0,
                "lastRunAt": _iso(last_start),
            }
        )

    recent = [
        {
            "id": r.id,
            "name": r.name,
            "status": r.status,
            "startedAt": _iso(r.started_at),
            "endedAt": _iso(r.ended_at),
            "durationMs": int((r.ended_at - r.started_at).total_seconds() * 1000) if r.ended_at else None,
            "events": event_counts.get(r.id, 0),
            "project": {"id": r.project_id, "name": projects_by_id[r.project_id].name},
        }
        for r in recent_runs
    ]

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
