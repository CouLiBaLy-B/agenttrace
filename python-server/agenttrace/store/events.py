"""Event/run writes shared by `POST /api/events` and the SDK's SqlStore, so
both write paths assign `seq`, default `status` and encode `payload`
identically."""

from __future__ import annotations

import json
from datetime import datetime, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from . import models

VALID_EVENT_TYPES = frozenset({"llm_call", "tool_call", "tool_result", "handoff", "error", "final_answer"})


def create_run(db: Session, project_id: str, name: str) -> models.Run:
    run = models.Run(project_id=project_id, name=name, status="running")
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


def append_event(db: Session, run_id: str, body: dict) -> models.Event:
    """`body` uses the wire field names; the caller validated source/target/type."""
    seq = db.query(func.count(models.Event.id)).filter(models.Event.run_id == run_id).scalar()
    type_ = str(body["type"])
    payload = body.get("payload") if body.get("payload") is not None else {}
    event = models.Event(
        run_id=run_id,
        seq=seq,
        source=str(body["source"]),
        target=str(body["target"]),
        type=type_,
        label=str(body["label"]) if body.get("label") else None,
        payload=json.dumps(payload, default=str),  # non-JSON values must not lose the event
        duration_ms=int(body["durationMs"]) if body.get("durationMs") is not None else None,
        status=body.get("status") or ("error" if type_ == "error" else "ok"),
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def close_run(db: Session, run: models.Run, end_status: str) -> models.Run:
    run.status = "failed" if end_status == "failed" else "completed"
    run.ended_at = datetime.now(timezone.utc)
    db.commit()
    return run
