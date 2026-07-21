"""Port of src/app/api/seed/route.ts — reload demo data (Settings view button)."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import models
from ..db import get_db
from ..deps import require_user
from ..seed import seed_demo_data

router = APIRouter(prefix="/api/seed", tags=["seed"])


@router.post("")
def reload_seed(user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    seed_demo_data(db, user.id)
    return {"ok": True}
