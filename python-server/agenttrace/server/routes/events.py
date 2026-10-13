"""Port of src/app/api/events/route.ts — the ingestion endpoint used by
integrations/agenttrace-langchain (POST /api/events, project API-key auth).

Body: {runId, source, target, type, label?, payload?, durationMs?, status?, endRun?}
Or:   {runId: null, name} to create a new run.
The body also accepts `project` (a project name), used only when no API key is
sent, i.e. in `--auth none` local mode.

This is the one contract that must not drift — the already-shipped
`agenttrace-langchain` middleware talks to exactly this shape.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from sqlalchemy.orm import Session

from ...store.local import get_or_create_local_user, get_or_create_project
from ...store.events import VALID_EVENT_TYPES, append_event, close_run, create_run
from .. import models
from ..db import get_db
from ..deps import ingest_project
from ..serializers import event_out

router = APIRouter(prefix="/api/events", tags=["events"])


@router.post("")
async def ingest(
    request: Request,
    project: models.Project | None = Depends(ingest_project),
    db: Session = Depends(get_db),
):
    try:
        body = await request.json()
    except ValueError:  # malformed or empty JSON, or bytes that aren't text
        body = None
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail={"error": "Invalid JSON body"})
    # Sync SQLAlchemy work off the event loop: a SQLite file locked by another
    # writer (busy timeout 30 s) must not stall the poller and websockets.
    return await run_in_threadpool(_ingest, db, project, body)


def _ingest(db: Session, project: models.Project | None, body: dict):
    run_id = body.get("runId")

    if not run_id:
        name = str(body.get("name") or "Untitled run")
        if project is None:
            project_name = body.get("project")
            if not project_name:
                raise HTTPException(
                    status_code=400, detail={"error": "project is required when no API key is sent"}
                )
            project = get_or_create_project(db, get_or_create_local_user(db), str(project_name))
        run = create_run(db, project.id, name)
        return JSONResponse(status_code=201, content={"runId": run.id, "event": None})

    run = db.get(models.Run, run_id)
    if not run or (project is not None and run.project_id != project.id):
        raise HTTPException(status_code=404, detail={"error": "Run not found in this project"})

    if body.get("endRun"):
        close_run(db, run, body["endRun"])
        return {"runId": run_id, "closed": True, "status": run.status}

    source, target, type_ = body.get("source"), body.get("target"), body.get("type")
    if not source or not target or not type_:
        raise HTTPException(status_code=400, detail={"error": "source, target, type are required"})
    if type_ not in VALID_EVENT_TYPES:
        raise HTTPException(
            status_code=400, detail={"error": f"type must be one of: {', '.join(sorted(VALID_EVENT_TYPES))}"}
        )

    event = append_event(db, run_id, body)

    return JSONResponse(status_code=201, content={"runId": run_id, "event": event_out(event)})
