"""POST /api/seed — load the demo projects for the current user (the local
user in `--auth none` mode). Idempotent: does nothing if projects exist."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import models
from ..db import get_db
from ..demo import seed_demo
from ..deps import require_user

router = APIRouter(prefix="/api/seed", tags=["seed"])


@router.post("")
def seed(user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    return {"seeded": seed_demo(db, user)}
