"""Port of src/app/api/events/route.ts — the ingestion endpoint used by
integrations/agenttrace-langchain (POST /api/events, project API-key auth).

Body: {runId, source, target, type, label?, payload?, durationMs?, status?, endRun?}
Or:   {runId: null, name} to create a new run.

This is the one contract that must not drift — the already-shipped
`agenttrace-langchain` middleware talks to exactly this shape.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from ...store.events import VALID_EVENT_TYPES, append_event, close_run, create_run
from .. import models
from ..db import get_db
from ..deps import authenticate_api_key
from ..realtime import manager
from ..serializers import event_out

router = APIRouter(prefix="/api/events", tags=["events"])


@router.post("")
async def ingest(
    request: Request,
    project: models.Project = Depends(authenticate_api_key),
    db: Session = Depends(get_db),
):
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail={"error": "Invalid JSON body"})

    run_id = body.get("runId")

    if not run_id:
        name = str(body.get("name") or "Untitled run")
        run = create_run(db, project.id, name)
        return JSONResponse(status_code=201, content={"runId": run.id, "event": None})

    run = db.get(models.Run, run_id)
    if not run or run.project_id != project.id:
        raise HTTPException(status_code=404, detail={"error": "Run not found in this project"})

    if body.get("endRun"):
        close_run(db, run, body["endRun"])
        manager.broadcast_run_update(run_id, {"status": run.status, "endedAt": run.ended_at.isoformat()})
        return {"runId": run_id, "closed": True, "status": run.status}

    source, target, type_ = body.get("source"), body.get("target"), body.get("type")
    if not source or not target or not type_:
        raise HTTPException(status_code=400, detail={"error": "source, target, type are required"})
    if type_ not in VALID_EVENT_TYPES:
        raise HTTPException(
            status_code=400, detail={"error": f"type must be one of: {', '.join(sorted(VALID_EVENT_TYPES))}"}
        )

    event = append_event(db, run_id, body)

    manager.broadcast_event(run_id, event_out(event))

    return JSONResponse(status_code=201, content={"runId": run_id, "event": event_out(event)})
