"""Port of src/app/api/events/route.ts — the ingestion endpoint used by
integrations/agenttrace-langchain (POST /api/events, project API-key auth).

Body: {runId, source, target, type, label?, payload?, durationMs?, status?, endRun?}
Or:   {runId: null, name} to create a new run.

This is the one contract that must not drift — the already-shipped
`agenttrace-langchain` middleware talks to exactly this shape.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models
from ..db import get_db
from ..deps import authenticate_api_key
from ..realtime import manager
from ..serializers import event_out

router = APIRouter(prefix="/api/events", tags=["events"])

VALID_EVENT_TYPES = {"llm_call", "tool_call", "tool_result", "handoff", "error", "final_answer"}


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
        run = models.Run(project_id=project.id, name=name, status="running")
        db.add(run)
        db.commit()
        db.refresh(run)
        return JSONResponse(status_code=201, content={"runId": run.id, "event": None})

    run = db.get(models.Run, run_id)
    if not run or run.project_id != project.id:
        raise HTTPException(status_code=404, detail={"error": "Run not found in this project"})

    if body.get("endRun"):
        status = "failed" if body["endRun"] == "failed" else "completed"
        run.status = status
        run.ended_at = datetime.now(timezone.utc)
        db.commit()
        manager.broadcast_run_update(run_id, {"status": status, "endedAt": run.ended_at.isoformat()})
        return {"runId": run_id, "closed": True, "status": status}

    source, target, type_ = body.get("source"), body.get("target"), body.get("type")
    if not source or not target or not type_:
        raise HTTPException(status_code=400, detail={"error": "source, target, type are required"})
    if type_ not in VALID_EVENT_TYPES:
        raise HTTPException(
            status_code=400, detail={"error": f"type must be one of: {', '.join(sorted(VALID_EVENT_TYPES))}"}
        )

    seq = db.query(func.count(models.Event.id)).filter(models.Event.run_id == run_id).scalar()
    payload = body.get("payload") if body.get("payload") is not None else {}

    event = models.Event(
        run_id=run_id,
        seq=seq,
        source=str(source),
        target=str(target),
        type=str(type_),
        label=str(body["label"]) if body.get("label") else None,
        payload=json.dumps(payload),
        duration_ms=int(body["durationMs"]) if body.get("durationMs") is not None else None,
        status=body.get("status") or ("error" if type_ == "error" else "ok"),
    )
    db.add(event)
    db.commit()
    db.refresh(event)

    manager.broadcast_event(run_id, event_out(event))

    return JSONResponse(status_code=201, content={"runId": run_id, "event": event_out(event)})
