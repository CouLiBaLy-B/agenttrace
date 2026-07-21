"""Plain-dict JSON serialization matching the Next.js route handlers' shapes
(camelCase keys, ISO datetimes) — no ORM-to-schema abstraction layer, since
each route's shape is small and route-specific (mirrors how the original
`route.ts` handlers build their own `NextResponse.json(...)` bodies by hand).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from . import models


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() if dt else None


def user_out(user: models.User) -> dict[str, Any]:
    return {"id": user.id, "email": user.email, "name": user.name}


def project_out(project: models.Project, *, run_count: int | None = None, latest_runs: list | None = None) -> dict[str, Any]:
    data: dict[str, Any] = {
        "id": project.id,
        "name": project.name,
        "description": project.description,
        "userId": project.user_id,
        "createdAt": _iso(project.created_at),
        "updatedAt": _iso(project.updated_at),
    }
    if run_count is not None:
        data["_count"] = {"runs": run_count}
    if latest_runs is not None:
        data["runs"] = [
            {"id": r.id, "name": r.name, "status": r.status, "startedAt": _iso(r.started_at)} for r in latest_runs
        ]
    return data


def project_detail_out(project: models.Project) -> dict[str, Any]:
    data = project_out(project)
    data["runs"] = [run_out(r, event_count=len(r.events)) for r in project.runs]
    data["apiKeys"] = [
        {
            "id": k.id,
            "prefix": k.prefix,
            "label": k.label,
            "createdAt": _iso(k.created_at),
            "lastUsedAt": _iso(k.last_used_at),
        }
        for k in project.api_keys
    ]
    return data


def run_out(run: models.Run, *, event_count: int | None = None) -> dict[str, Any]:
    data: dict[str, Any] = {
        "id": run.id,
        "projectId": run.project_id,
        "name": run.name,
        "status": run.status,
        "startedAt": _iso(run.started_at),
        "endedAt": _iso(run.ended_at),
        "metadata": run.metadata_,
    }
    if event_count is not None:
        data["_count"] = {"events": event_count}
    return data


def run_detail_out(run: models.Run) -> dict[str, Any]:
    data = run_out(run)
    data["events"] = [event_out(e) for e in run.events]
    # Only the single-run detail view nests the project (matches the
    # original route.ts's `include: { project: { select: {...} } }` —
    # list views already know which project they're scoped to).
    data["project"] = {
        "id": run.project.id,
        "name": run.project.name,
        "userId": run.project.user_id,
    }
    return data


def event_out(event: models.Event) -> dict[str, Any]:
    import json

    try:
        payload = json.loads(event.payload)
    except (TypeError, ValueError):
        payload = event.payload
    return {
        "id": event.id,
        "runId": event.run_id,
        "timestamp": _iso(event.timestamp),
        "seq": event.seq,
        "source": event.source,
        "target": event.target,
        "type": event.type,
        "label": event.label,
        "payload": payload,
        "durationMs": event.duration_ms,
        "status": event.status,
    }


def key_out(key: models.ApiKey) -> dict[str, Any]:
    return {
        "id": key.id,
        "prefix": key.prefix,
        "label": key.label,
        "createdAt": _iso(key.created_at),
        "lastUsedAt": _iso(key.last_used_at),
    }
